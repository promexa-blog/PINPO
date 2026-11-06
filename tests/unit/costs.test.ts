import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { getModel } from "@/server/models/registry";
import { clipListPrice, deliveredListPrice } from "@/server/models/pricing";
import { addCost, confirmManual, costSummary, costTotalsByMonth } from "@/server/jobs/costs";
import { seedBundledBrand } from "@/server/brand/kits";
import { seedTemplates } from "@/server/planning/templates";
import { createAd } from "@/server/db/repos/versions";
import { deleteVersion, forkVersion } from "@/server/db/repos/lifecycle";
import { enqueue } from "@/server/jobs/queue";

/**
 * Money (test-suite audit P0): list prices, the calculated cost of a delivered clip, and the ledger.
 * Expected values are worked out by hand from the price tables, not recomputed with the code's formula.
 */

beforeAll(async () => {
  await seedBundledBrand();
  seedTemplates();
});

const D = "2026-11-06";

describe("list price per request (C1)", () => {
  it.each([
    // model, resolution, planned s, audio, requested s, usd
    ["wan-3.0", "720p", 2.9, false, 3, 0.3], // rounds up to whole seconds: 3 × $0.10
    ["wan-3.0", "1080p", 4.0, false, 4, 0.8], // 4 × $0.20
    ["wan-3.0", "480p", 1.2, false, 2, 0.1], // below the 2 s minimum → 2 × $0.05
    ["wan-3.0", "720p", 31, false, 30, 3.0], // above the 30 s maximum → 30 × $0.10
    ["kling-v3-pro", "720p", 4.2, true, 5, 0.84], // 5 × ($0.112 + $0.056 audio)
    ["kling-v3-pro", "720p", 4.2, false, 5, 0.56], // 5 × $0.112
    ["kling-v3-pro", "720p", 2, false, 3, 0.336], // below the 3 s minimum
  ] as const)("%s %s %ss audio=%s → %ss, $%s", (id, res, planned, audio, requestedS, usd) => {
    expect(clipListPrice(getModel(id), res, planned, D, "t2v", audio)).toEqual({ requestedS, usd });
  });

  it("calculated cost uses the DELIVERED duration, not the requested one (C3 basis)", () => {
    expect(deliveredListPrice(getModel("wan-3.0"), "720p", 3.04, D)).toBe(0.304);
    expect(deliveredListPrice(getModel("kling-v3-pro"), "720p", 5.0, D, "t2v", true)).toBe(0.84);
  });
});

describe("cost ledger", () => {
  const newVersion = (name: string) => createAd({ name, templateKey: "product_showcase", platform: "instagram_reels" }).versionId;

  it("counts each fal request once per kind and keeps categories apart (C3)", () => {
    const v = newVersion("ledger");
    addCost({ kind: "estimated", usd: 0.9, versionId: v });
    addCost({ kind: "calculated", usd: 0.304, versionId: v, falRequestId: "req-a" });
    addCost({ kind: "calculated", usd: 0.304, versionId: v, falRequestId: "req-a" }); // replay: ignored
    addCost({ kind: "exposure_failed", usd: 0.3, versionId: v, falRequestId: "req-b" });
    addCost({ kind: "exposure_failed", usd: 0.3, versionId: v, falRequestId: "req-c" });
    addCost({ kind: "exposure_canceled", usd: 0.2, versionId: v, falRequestId: "req-d" });
    const s = costSummary(v);
    expect(s).toMatchObject({ estimated: 0.9, calculated: 0.304, exposure: { failed: 0.6, canceled: 0.2, duplicate: 0, total: 0.8 }, confirmed: null, mock: false });
  });

  it("mock attempts cost $0, but mock estimates keep list prices (plan §10)", () => {
    const v = newVersion("mock-ledger");
    addCost({ kind: "estimated", usd: 0.9, versionId: v, mock: true });
    addCost({ kind: "calculated", usd: 0.3, versionId: v, falRequestId: "mock-a", mock: true });
    addCost({ kind: "exposure_failed", usd: 0.3, versionId: v, falRequestId: "mock-b", mock: true });
    expect(costSummary(v)).toMatchObject({ estimated: 0.9, calculated: 0, exposure: { total: 0 }, mock: true });
  });

  it("a manual confirmation replaces the previous one and reconciles calculated/exposure (C2, C7)", () => {
    const v = newVersion("confirm");
    addCost({ kind: "calculated", usd: 0.5, versionId: v, falRequestId: "conf-a" });
    addCost({ kind: "exposure_failed", usd: 0.3, versionId: v, falRequestId: "conf-b" });
    confirmManual(v, 0.75, "fal dashboard, Nov");
    confirmManual(v, 0.8, "fal dashboard, corrected");
    const s = costSummary(v);
    expect(s.confirmed).toBe(0.8);
    expect(s.calculated).toBe(0); // reconciled rows no longer count…
    expect(s.exposure.total).toBe(0);
    expect(s.entries.filter((e) => e.reconciled).map((e) => e.kind).sort()).toEqual(["calculated", "exposure_failed"]); // …but stay for audit
    expect(s.entries.filter((e) => e.kind === "confirmed_manual")).toHaveLength(1);
  });

  it("deleting a version keeps its spend in the monthly totals (reliability audit #9)", () => {
    const v = newVersion("delete-keeps-spend");
    addCost({ kind: "calculated", usd: 1.234, versionId: v, falRequestId: "del-a" });
    const month = new Date().toISOString().slice(0, 7);
    const before = costTotalsByMonth().find((m) => m.month === month)!.calculated;
    db().prepare("UPDATE ad_versions SET status = 'ready' WHERE id = ?").run(v);
    const { versionId: v2 } = forkVersion(v);
    db().prepare("UPDATE ads SET current_version_id = ? WHERE current_version_id = ?").run(v2, v);
    deleteVersion(v);
    expect(costTotalsByMonth().find((m) => m.month === month)!.calculated).toBeCloseTo(before, 4);
    const row = db().prepare("SELECT version_id, note FROM cost_entries WHERE fal_request_id = 'del-a'").get() as { version_id: string | null; note: string };
    expect(row).toEqual({ version_id: null, note: "(version deleted)" });
  });

  it("refuses to delete a canceled version whose jobs are still stopping (reliability audit #8)", () => {
    const v = newVersion("stopping");
    db().prepare("UPDATE ad_versions SET status = 'canceled' WHERE id = ?").run(v);
    db().prepare("UPDATE ad_versions SET status = 'ready' WHERE id = ?").run(v);
    const { versionId: v2 } = forkVersion(v);
    db().prepare("UPDATE ads SET current_version_id = ? WHERE current_version_id = ?").run(v2, v);
    db().prepare("UPDATE ad_versions SET status = 'canceled' WHERE id = ?").run(v);
    const job = enqueue({ type: "compose", idempotencyKey: `compose:${v}`, versionId: v, input: { versionId: v } });
    db().prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id);
    expect(() => deleteVersion(v)).toThrow(expect.objectContaining({ code: "VERSION_STOPPING", status: 409 }));
    db().prepare("UPDATE jobs SET status = 'canceled' WHERE id = ?").run(job.id);
    expect(() => deleteVersion(v)).not.toThrow();
  });
});
