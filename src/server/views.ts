import "./guard";
import { db } from "./db";
import { getBrief, getScenes, requireVersion, settingsOf, finishingOf } from "./db/repos/versions";
import { checkDraft, draftScenes } from "./planning/draft";
import { costSummary } from "./jobs/costs";
import { getItems, exportGate, hasFinalAttestation, FINAL_ATTESTATION } from "./qa/reports";
import { getAsset } from "./storage/assets";
import { sha256 } from "./util";

/** Read model for GET /api/versions/[vid] — side-effect free, ETag-able (plan §4, §13). */
export function versionView(versionId: string) {
  const v = requireVersion(versionId);
  const ad = db().prepare("SELECT id, name, current_version_id FROM ads WHERE id = ?").get(v.ad_id) as { id: string; name: string; current_version_id: string };
  const versions = db().prepare("SELECT id, number, status, qa_status, created_at FROM ad_versions WHERE ad_id = ? ORDER BY number DESC").all(v.ad_id);
  const rows = getScenes(versionId);
  const scenes = draftScenes(versionId);
  const jobs = db()
    .prepare("SELECT id, type, scene_id, status, stage, attempt, max_attempts, queue_position, progress, error_code, error_message, cancel_requested, updated_at FROM jobs WHERE version_id = ? ORDER BY created_at")
    .all(versionId) as { id: string; type: string; scene_id: string | null; status: string; stage: string; attempt: number; max_attempts: number; queue_position: number | null; progress: number | null; error_code: string | null; error_message: string | null; cancel_requested: number; updated_at: number }[];
  const latestJobFor = (sceneId: string) => [...jobs].reverse().find((j) => j.scene_id === sceneId && j.type === "scene_generate") ?? null;
  const product = (id: string | null) => {
    const a = id ? getAsset(id) : undefined;
    return a ? { id: a.id, width: a.width, height: a.height } : null;
  };
  const events = db()
    .prepare(`SELECT e.id, e.at, e.job_id, e.to_status, e.stage, e.message FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.version_id = ? ORDER BY e.id DESC LIMIT 40`)
    .all(versionId);
  const brief = getBrief(versionId);
  const view = {
    ad,
    versions,
    version: {
      id: v.id,
      number: v.number,
      status: v.status,
      qaStatus: v.qa_status,
      revision: v.revision,
      platform: v.platform,
      pacing: v.pacing,
      errorCode: v.error_code,
      errorMessage: v.error_message,
      finalAssetId: v.final_asset_id,
      thumbAssetId: v.thumb_asset_id,
      lockedAt: v.locked_at,
      updatedAt: v.updated_at,
    },
    settings: settingsOf(v),
    finishing: finishingOf(v),
    brief,
    productImages: brief.product.imageAssetIds.map((id) => product(id)).filter(Boolean),
    scenes: scenes.map((s, i) => ({ ...s, id: rows[i]!.id, status: rows[i]!.status, clipAssetId: rows[i]!.clip_asset_id, job: latestJobFor(rows[i]!.id) })),
    composeJob: [...jobs].reverse().find((j) => j.type === "compose") ?? null,
    check: v.status === "draft" ? checkDraft(versionId) : null,
    costs: costSummary(versionId),
    qa: getItems(versionId),
    exportGate: v.status === "ready" ? exportGate(versionId) : null,
    attested: hasFinalAttestation(versionId),
    attestationText: FINAL_ATTESTATION,
    events,
  };
  return { view, etag: `"${sha256(JSON.stringify(view)).slice(0, 32)}"` };
}

export type VersionView = ReturnType<typeof versionView>["view"];
