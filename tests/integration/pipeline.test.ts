import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/server/db";
import { seedMasterBrand } from "@/server/brand/master";
import { seedTemplates } from "@/server/planning/templates";
import { createAd, getBrief, patchDraft, requireVersion } from "@/server/db/repos/versions";
import { applyStoryboard, checkDraft } from "@/server/planning/draft";
import { startGenerate, cancelVersion } from "@/server/jobs/generate";
import { storeUpload } from "@/server/storage/upload";
import { UploadMeta } from "@/lib/schemas";
import { costSummary } from "@/server/jobs/costs";
import { forkVersion } from "@/server/db/repos/lifecycle";
import { saveAsTemplate } from "@/server/planning/save-template";
import { getTemplate } from "@/server/planning/templates";
import { getItems, exportGate, acknowledge, attest } from "@/server/qa/reports";
import { getAsset, absolutePath } from "@/server/storage/assets";
import { probe } from "@/server/media/probe";
import { renderer } from "@/server/render/browser";
import { ffmpeg } from "@/server/media/run";
import { readFileSync } from "node:fs";
import { paths } from "@/server/paths";

/**
 * End-to-end with the mock provider (plan I1, I3, I9, I10, C3, Q-gate): a real worker process
 * generates scenes, composes, runs QA. Kills the worker mid-generation to prove recovery.
 */

let worker: ChildProcess | null = null;
const logs: string[] = [];
const startWorker = (env: Record<string, string> = {}) => {
  const w = spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], { env: { ...process.env, FAL_MOCK: "1", MOCK_QUEUE_MS: "800", MOCK_RUN_MS: "1500", FAL_POLL_MS: "250", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  w.stdout!.on("data", (d) => logs.push(d.toString()));
  w.stderr!.on("data", (d) => logs.push(d.toString()));
  return w;
};
const stopWorker = async (w: ChildProcess | null, signal: NodeJS.Signals = "SIGTERM") => {
  if (!w || w.exitCode !== null) return;
  const done = new Promise((r) => w.on("exit", r));
  w.kill(signal);
  await done;
};
const ensureWorker = () => {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) worker = startWorker();
};
const waitFor = async (fn: () => boolean, ms: number, what: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const jobs = db().prepare("SELECT type, status, stage, attempt, error_code, error_message, lease_owner IS NOT NULL AS leased FROM jobs ORDER BY created_at DESC LIMIT 12").all();
  throw new Error(`Timed out waiting for ${what}.\nJobs: ${JSON.stringify(jobs)}\nWorker log tail:\n${logs.join("").slice(-3000)}`);
};

async function makeAd(name: string, promptMarker = "", opts: { templateKey?: string; modelId?: "seedance-2.0-mini"; outro?: "promotional"; lengthS?: 30 } = {}) {
  const { versionId } = createAd({ name, templateKey: opts.templateKey ?? "product_showcase", platform: "instagram_reels" });
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#b03a2e" } })
    .composite([{ input: await sharp({ create: { width: 500, height: 300, channels: 3, background: "#1b2631" } }).png().toBuffer(), left: 200, top: 450 }])
    .png()
    .toBuffer();
  const product = await storeUpload(png, `${name}.png`, UploadMeta.parse({ purpose: "product_image", provenance: { sourceType: "own_photo", commercialUse: "yes", permissionConfirmed: true } }));
  const brief = getBrief(versionId);
  const v = requireVersion(versionId);
  patchDraft(versionId, {
    revision: v.revision,
    brief: {
      ...brief,
      product: { name: "Steel Lunch Box", category: "home_kitchen", appearance: "a brushed stainless-steel three-tier lunch box with a matte black clip handle", imageAssetIds: [product.id] },
      audience: { who: "a young office worker in Kochi", location: "Kerala, India" },
      offers: { priceInr: 899, mrpInr: 1299, stockConfirmed: false, confirmedOn: new Date().toISOString().slice(0, 10), ...(opts.templateKey === "group_buy" ? { groupBuy: { groupPriceInr: 799, minBuyers: 5, deadline: "2099-12-31" } } : {}) },
      creative: { direction: promptMarker, tone: "friendly", style: "lifestyle" },
      claims: [
        { language: "en", text: "Three separate tiers keep food apart", confirmed: true, attested: false, testimonialConsent: false },
        { language: "en", text: "Clip handle carries easily", confirmed: true, attested: false, testimonialConsent: false },
      ],
    },
  });
  if (opts.modelId || opts.outro || opts.lengthS) {
    const v2 = requireVersion(versionId);
    const settings = JSON.parse(v2.settings_json);
    const finishing = JSON.parse(v2.finishing_json);
    patchDraft(versionId, { revision: v2.revision, settings: { ...settings, ...(opts.modelId ? { modelId: opts.modelId } : {}), ...(opts.lengthS ? { lengthS: opts.lengthS } : {}) }, finishing: { ...finishing, ...(opts.outro ? { outroType: opts.outro } : {}) } });
  }
  const sb = applyStoryboard(versionId, true);
  expect(sb.applied).toBe(true);
  expect(sb.storyboard.blocked).toBe(false);
  return versionId;
}

beforeAll(async () => {
  await seedMasterBrand();
  seedTemplates();
});
afterAll(async () => {
  await stopWorker(worker);
  await renderer.close();
});

describe("vertical slice pipeline (mock fal)", () => {
  it("generates, composes and QA-checks a 15s 9:16 Product showcase ad, surviving a worker crash (I1, I3)", async () => {
    const versionId = await makeAd("slice");
    const check = checkDraft(versionId);
    expect(check.blocking).toEqual([]);
    expect(check.timeline!.totalS).toBeCloseTo(15, 1);
    await startGenerate(versionId);
    expect(requireVersion(versionId).status).toBe("generating");

    worker = startWorker();
    // Wait until at least one AI scene has a fal request, then SIGKILL the worker mid-generation.
    await waitFor(() => !!db().prepare("SELECT 1 FROM jobs WHERE version_id = ? AND fal_request_id IS NOT NULL").get(versionId), 60_000, "a submitted AI scene");
    const before = (db().prepare("SELECT COUNT(DISTINCT fal_request_id) AS n FROM jobs WHERE version_id = ? AND fal_request_id IS NOT NULL").get(versionId) as { n: number }).n;
    await stopWorker(worker, "SIGKILL");
    // Lease expiry: simulate the 60s passing so the new worker reclaims immediately.
    db().prepare("UPDATE jobs SET lease_expires_at = 0 WHERE status = 'running'").run();
    db().prepare("UPDATE workers SET lease_expires_at = 0").run();
    worker = startWorker();

    await waitFor(() => ["ready", "failed"].includes(requireVersion(versionId).status), 240_000, "version ready");
    const v = requireVersion(versionId);
    expect(v.error_message).toBeNull();
    expect(v.status).toBe("ready");

    // No duplicate submissions for scenes that already had a request (I3).
    const reclaimEvents = db().prepare("SELECT COUNT(*) AS n FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.version_id = ? AND e.message = 'reclaimed after expired lease'").get(versionId) as { n: number };
    expect(reclaimEvents.n).toBeGreaterThan(0);
    const after = db().prepare("SELECT fal_request_id FROM jobs WHERE version_id = ? AND type = 'scene_generate' AND fal_request_id IS NOT NULL").all(versionId) as { fal_request_id: string }[];
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(costSummary(versionId).exposure.duplicate).toBe(0);

    // Final video: exact length, size, faststart (validated by the worker; double-check here).
    const final = getAsset(v.final_asset_id!)!;
    const info = await probe(absolutePath(final));
    expect(info.video).toMatchObject({ width: 1080, height: 1920, codec: "h264" });
    expect(Math.abs(info.durationS - 15)).toBeLessThanOrEqual(0.1);

    // QA: technical all pass; AI product scene needs review; export gate requires review + attestation.
    const items = getItems(versionId);
    expect(items.filter((i) => i.reportKind === "technical" && i.status === "fail")).toEqual([]);
    expect(items.find((i) => i.check === "product_appearance" && i.method === "automated")?.status).toBe("pass");
    expect(items.some((i) => i.check === "product_appearance" && i.status === "needs_review")).toBe(true);
    expect(items.filter((i) => i.status === "fail")).toEqual([]);
    expect(exportGate(versionId).ok).toBe(false);
    for (const it of items.filter((i) => i.status === "needs_review")) acknowledge(versionId, it.id);
    expect(exportGate(versionId).reasons).toEqual(["Confirm that claims, prices and offers are accurate."]);
    attest(versionId);
    expect(exportGate(versionId).ok).toBe(true);

    // Costs: mock → $0 calculated, estimate recorded, labelled separately.
    const cost = costSummary(versionId);
    expect(cost.mock).toBe(true);
    expect(cost.estimated).toBeGreaterThan(0);
    expect(cost.confirmed).toBeNull();
  }, 300_000);

  it("produces a group-buy ad with reference-image scenes and the promotional outro (Seedance ref mode)", async () => {
    ensureWorker();
    const versionId = await makeAd("groupbuy", "", { templateKey: "group_buy", modelId: "seedance-2.0-mini", outro: "promotional", lengthS: 30 });
    const scenes = db().prepare("SELECT scene_type, overlay_json FROM scenes WHERE version_id = ?").all(versionId) as { scene_type: string; overlay_json: string }[];
    expect(scenes.some((s) => s.scene_type === "ai_reference")).toBe(true);
    expect(scenes.map((s) => s.overlay_json).join()).toContain("Group price when 5 people join");
    expect(checkDraft(versionId).blocking).toEqual([]);
    await startGenerate(versionId);
    await waitFor(() => ["ready", "failed"].includes(requireVersion(versionId).status), 240_000, "group-buy version");
    expect(requireVersion(versionId).error_message).toBeNull();
    const jobs = db().prepare("SELECT fal_endpoint, result_json FROM jobs WHERE version_id = ? AND type = 'scene_generate' AND fal_endpoint IS NOT NULL").all(versionId) as { fal_endpoint: string; result_json: string }[];
    expect(jobs.some((j) => j.fal_endpoint === "bytedance/seedance-2.0/mini/reference-to-video")).toBe(true);
    const items = getItems(versionId);
    expect(items.filter((i) => i.status === "fail")).toEqual([]);
    expect(items.find((i) => i.check === "end_card_correctness")?.message).toMatch(/Promotional/);
  }, 300_000);

  it("warns about voiceover timing (V2) and blocks export without voice consent (PV3)", async () => {
    ensureWorker();
    const versionId = await makeAd("voiceover");
    const wav = path.join(paths.work, "vo-test.wav");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=f=800:d=6:sample_rate=48000", wav]);
    const vo = await storeUpload(readFileSync(wav), "vo.wav", UploadMeta.parse({ purpose: "voiceover", provenance: { sourceType: "recorded_voice", license: "Owned by DemandMesh", commercialUse: "yes", talentConsent: false } }));
    const v = requireVersion(versionId);
    patchDraft(versionId, { revision: v.revision, voiceovers: [{ assetId: vo.id, scenePosition: 2, offsetS: 1, volumeDb: 0, fadeInS: 0.1, fadeOutS: 0.2, muted: false }] });
    const check = checkDraft(versionId);
    expect(check.warnings.map((w) => w.message).join(" ")).toMatch(/runs .* (past the end|into the next scene)/);
    expect(check.warnings.map((w) => w.message).join(" ")).toMatch(/no voice-artist consent/);
    await startGenerate(versionId);
    await waitFor(() => ["ready", "failed"].includes(requireVersion(versionId).status), 240_000, "voiceover version");
    expect(requireVersion(versionId).status, requireVersion(versionId).error_message ?? "").toBe("ready");
    const rights = getItems(versionId).filter((i) => i.check === "asset_rights");
    expect(rights.some((i) => i.status === "fail" && /consent/.test(i.message))).toBe(true);
    attest(versionId);
    expect(exportGate(versionId).ok).toBe(false);
    const tech = getItems(versionId).find((i) => i.check === "technical_loudness");
    expect(tech?.status).toBe("pass");
  }, 300_000);

  it("re-composes a finishing-only change with 0 new fal jobs and keeps the old final (I16) + save as template", async () => {
    ensureWorker();
    const v1 = await makeAd("reuse");
    await startGenerate(v1);
    await waitFor(() => ["ready", "failed"].includes(requireVersion(v1).status), 240_000, "v1");
    const oldFinal = requireVersion(v1).final_asset_id!;
    const fork = forkVersion(v1);
    expect(fork.created).toBe(true);
    const v2 = requireVersion(fork.versionId);
    const finishing = JSON.parse(v2.finishing_json);
    patchDraft(fork.versionId, { revision: v2.revision, finishing: { ...finishing, outroType: "minimal" } });
    const r = await startGenerate(fork.versionId);
    expect(r.jobs).toBe(0);
    expect(r.reused).toBeGreaterThan(0);
    await waitFor(() => ["ready", "failed"].includes(requireVersion(fork.versionId).status), 240_000, "v2");
    expect(requireVersion(fork.versionId).status).toBe("ready");
    expect(requireVersion(fork.versionId).final_asset_id).not.toBe(oldFinal);
    expect(getAsset(oldFinal)).toBeDefined();
    expect((db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE version_id = ? AND type = 'scene_generate'").get(fork.versionId) as { n: number }).n).toBe(0);
    expect(costSummary(fork.versionId).estimated).toBe(0);
    const t = saveAsTemplate(v1, "Lunch box layout");
    const tpl = getTemplate(t.key)!;
    expect(tpl.scenes.length).toBe(requireVersion(v1) ? 4 : 0);
    expect(JSON.stringify(tpl)).not.toContain("Three separate tiers"); // structure, not copy
  }, 600_000);

  it("retries a failing fal run and records failed-attempt exposure (I9, C3)", async () => {
    ensureWorker();
    const versionId = await makeAd("retry", "[[mock:fail2]]");
    await startGenerate(versionId);
    await waitFor(() => ["ready", "failed"].includes(requireVersion(versionId).status), 240_000, "retry version");
    expect(requireVersion(versionId).status).toBe("ready");
    const cost = costSummary(versionId);
    const failedRows = cost.entries.filter((e) => e.kind === "exposure_failed");
    const calculated = cost.entries.filter((e) => e.kind === "calculated");
    expect(failedRows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(failedRows.map((e) => e.falRequestId)).size).toBe(failedRows.length); // one row per request
    expect(calculated.length).toBeGreaterThanOrEqual(1);
  }, 300_000);

  it("fails fast on content policy without retrying (I10)", async () => {
    ensureWorker();
    const versionId = await makeAd("policy", "[[mock:policy]]");
    await startGenerate(versionId);
    await waitFor(() => requireVersion(versionId).status === "failed", 120_000, "policy failure");
    const v = requireVersion(versionId);
    expect(v.error_message).toMatch(/content policy/);
    const attempts = db().prepare("SELECT MAX(attempt) AS a FROM jobs WHERE version_id = ? AND error_code = 'CONTENT_POLICY'").get(versionId) as { a: number };
    expect(attempts.a).toBe(1);
  }, 180_000);

  it("cancels a running version within seconds (I15)", async () => {
    ensureWorker();
    const versionId = await makeAd("cancel");
    await startGenerate(versionId);
    await waitFor(() => !!db().prepare("SELECT 1 FROM jobs WHERE version_id = ? AND stage IN ('in_queue','in_progress')").get(versionId), 60_000, "in-flight job");
    const t0 = Date.now();
    cancelVersion(versionId);
    await waitFor(() => (db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE version_id = ? AND status NOT IN ('canceled','succeeded','failed')").get(versionId) as { n: number }).n === 0, 15_000, "jobs canceled");
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(requireVersion(versionId).status).toBe("canceled");
  }, 120_000);
});
