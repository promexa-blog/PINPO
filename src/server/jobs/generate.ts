import "../guard";
import { db, tx } from "../db";
import { PLATFORMS } from "@/lib/platforms";
import { getModel, requestDuration, type GenMode } from "../models/registry";
import { pricingVersion } from "../models/pricing";
import { checkDraft, draftScenes } from "../planning/draft";
import { requireVersion, settingsOf, getScenes, getBrief } from "../db/repos/versions";
import { sceneMode } from "../planning/estimate";
import { getAsset } from "../storage/assets";
import { assertDiskSpace } from "../storage/disk";
import { enqueue, requestCancel } from "./queue";
import { addCost } from "./costs";
import { indiaToday } from "../brief/offers";
import { AppError, now, sha256, stableStringify } from "../util";

/** Snapshot given to each scene job — the worker never reads mutable draft data (plan §3). */
export interface SceneJobInput {
  versionId: string;
  sceneId: string;
  position: number;
  platform: keyof typeof PLATFORMS;
  width: number;
  height: number;
  aspect: "9:16" | "16:9" | "1:1";
  sceneType: "product_original" | "ai_from_product" | "ai_reference" | "ai_scene";
  durationS: number;
  prompt: string;
  productMotion: "push-in" | "pan" | "parallax" | "rotate-in";
  productAssetId: string | null;
  modelId: string;
  resolution: "480p" | "720p" | "1080p";
  clipAudio: boolean;
  seed: number;
  mode: GenMode | null;
  endpoint: string | null;
  referenceAssetIds: string[];
  requestedS: number;
  pricingDate: string;
}

const MB = 1024 * 1024;

export class DraftNotReady extends AppError {
  constructor(readonly items: { check: string; message: string }[]) {
    super("DRAFT_NOT_READY", items.map((i) => i.message).join(" "), 422);
  }
}

/** POST /generate (plan §4): validate, check disk, lock the version, enqueue scene jobs + estimates. Idempotent. */
export async function startGenerate(versionId: string): Promise<{ versionId: string; jobs: number; reused?: number }> {
  const v0 = requireVersion(versionId);
  if (v0.status !== "draft") return { versionId, jobs: 0 }; // already generating/generated → idempotent
  const check = checkDraft(versionId);
  if (!check.ok) throw new DraftNotReady(check.blocking);
  const scenes = draftScenes(versionId);
  await assertDiskSpace(scenes.length * 60 * MB + 200 * MB);

  return tx(() => {
    const v = requireVersion(versionId);
    if (v.status !== "draft") return { versionId, jobs: 0 };
    const settings = settingsOf(v);
    const model = getModel(settings.modelId);
    const p = PLATFORMS[v.platform];
    const date = indiaToday();
    const rows = getScenes(versionId);
    const brief = getBrief(versionId);
    let jobs = 0;
    let reused = 0;
    rows.forEach((row, i) => {
      const s = scenes[i]!;
      const ai = s.sceneType !== "product_original";
      const mode: GenMode | null = sceneMode(s.sceneType);
      const product = s.productAssetId ? getAsset(s.productAssetId) : undefined;
      const input: SceneJobInput = {
        versionId,
        sceneId: row.id,
        position: i,
        platform: v.platform,
        width: p.width,
        height: p.height,
        aspect: p.aspect,
        sceneType: s.sceneType,
        durationS: s.durationS,
        prompt: s.prompt,
        productMotion: s.creative.productMotion,
        productAssetId: s.productAssetId,
        modelId: model.id,
        resolution: settings.resolution,
        clipAudio: settings.clipAudio && model.audio === "toggle",
        seed: settings.seed,
        mode,
        endpoint: mode ? model.endpoints[mode] ?? null : null,
        referenceAssetIds: mode === "ref" ? brief.product.imageAssetIds.slice(0, model.references?.max ?? 0) : [],
        requestedS: ai ? requestDuration(model, s.durationS) : s.durationS,
        pricingDate: date,
      };
      const inputsHash = sha256(stableStringify({ ...input, versionId: undefined, sceneId: undefined, position: undefined, pricingDate: undefined, product: product?.sha256 }));
      // Clip reuse (plan §3): identical inputs anywhere in this ad → reuse the clip at $0, no fal call.
      const reuse = db()
        .prepare(
          `SELECT s.id, s.clip_asset_id FROM scenes s JOIN ad_versions av ON av.id = s.version_id
           WHERE av.ad_id = ? AND s.inputs_hash = ? AND s.status IN ('succeeded','reused') AND s.clip_asset_id IS NOT NULL AND s.version_id <> ? LIMIT 1`,
        )
        .get(v.ad_id, inputsHash, versionId) as { id: string; clip_asset_id: string } | undefined;
      if (reuse && getAsset(reuse.clip_asset_id)) {
        db().prepare("UPDATE scenes SET status = 'reused', inputs_hash = ?, clip_asset_id = ?, reused_from_scene_id = ? WHERE id = ?").run(inputsHash, reuse.clip_asset_id, reuse.id, row.id);
        reused++;
        return;
      }
      db().prepare("UPDATE scenes SET status = 'pending', inputs_hash = ? WHERE id = ?").run(inputsHash, row.id);
      enqueue({ type: "scene_generate", idempotencyKey: `scene:${row.id}:a1`, versionId, sceneId: row.id, input, priority: 50 + i, maxAttempts: 3 });
      jobs++;
      if (ai) {
        const est = check.estimate?.scenes[i];
        addCost({ kind: "estimated", usd: est?.usd ?? 0, versionId, sceneId: row.id, pricingVersion: pricingVersion(model, date), basis: { requestedS: input.requestedS, resolution: settings.resolution }, mock: process.env.FAL_MOCK === "1" });
      }
    });
    const settingsHash = sha256(stableStringify({ settings, platform: v.platform, pacing: v.pacing, finishing: v.finishing_json }));
    db().prepare("UPDATE ad_versions SET status = 'generating', locked_at = ?, settings_hash = ?, updated_at = ? WHERE id = ?").run(now(), settingsHash, now(), versionId);
    if (jobs === 0) {
      // Every scene reused (e.g. only finishing changed): straight to compose, no AI cost.
      db().prepare("UPDATE ad_versions SET status = 'composing', updated_at = ? WHERE id = ?").run(now(), versionId);
      enqueue({ type: "compose", idempotencyKey: `compose:${versionId}`, versionId, input: { versionId }, priority: 20, maxAttempts: 2 });
    }
    db().prepare("UPDATE ads SET updated_at = ? WHERE id = ?").run(now(), v.ad_id);
    return { versionId, jobs, reused };
  });
}

export function cancelVersion(versionId: string): number {
  const v = requireVersion(versionId);
  if (!["queued", "generating", "composing"].includes(v.status)) throw new AppError("NOT_RUNNING", "Nothing is running for this version.", 409);
  const n = requestCancel(versionId);
  db().prepare("UPDATE ad_versions SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('queued','generating','composing')").run(now(), versionId);
  return n;
}

/** Retry a failed scene as a new attempt (plan §4 POST /scenes/[id]/retry). */
export function retryScene(versionId: string, sceneId: string): void {
  tx(() => {
    const job = db().prepare("SELECT * FROM jobs WHERE scene_id = ? AND type = 'scene_generate' ORDER BY created_at DESC LIMIT 1").get(sceneId) as { status: string; input_json: string; attempt: number } | undefined;
    if (!job || job.status !== "failed") throw new AppError("NOT_FAILED", "Only failed scenes can be retried.", 409);
    const n = (db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE scene_id = ?").get(sceneId) as { n: number }).n;
    enqueue({ type: "scene_generate", idempotencyKey: `scene:${sceneId}:r${n}`, versionId, sceneId, input: JSON.parse(job.input_json), priority: 40, maxAttempts: 3 });
    db().prepare("UPDATE scenes SET status = 'pending' WHERE id = ?").run(sceneId);
    db().prepare("UPDATE ad_versions SET status = 'generating', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?").run(now(), versionId);
  });
}
