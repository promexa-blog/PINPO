import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { enqueue, getJob } from "@/server/jobs/queue";
import { retryScene, startGenerate } from "@/server/jobs/generate";
import { seedBundledBrand } from "@/server/brand/kits";
import { seedTemplates } from "@/server/planning/templates";
import { createAd, requireVersion } from "@/server/db/repos/versions";
import { createScheduler } from "@/worker/loop";
import { WORKER_ID } from "@/server/jobs/worker-lease";

/** Audit fixes: crash loops are bounded; retry revives the whole version; no key → clear refusal. */

beforeAll(async () => {
  await seedBundledBrand();
  seedTemplates();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("handler crash limit (reliability audit #2)", () => {
  it("retries a crashing job, then fails it and its version after 3 crashes", async () => {
    const { versionId } = createAd({ name: "crashy", templateKey: "product_showcase", platform: "instagram_reels" });
    db().prepare("UPDATE ad_versions SET status = 'composing' WHERE id = ?").run(versionId);
    const job = enqueue({ type: "compose", idempotencyKey: `compose:${versionId}`, versionId, input: { versionId } });
    let runs = 0;
    const scheduler = createScheduler("crash-test", [{ type: "compose", concurrency: () => 1, run: async () => { runs++; throw new Error("boom"); } }], () => undefined);
    for (let i = 0; i < 3; i++) {
      db().prepare("UPDATE jobs SET next_run_at = 0 WHERE id = ?").run(job.id);
      scheduler.tick();
      await settle();
      if (i < 2) expect(getJob(job.id)!.status).toBe("pending");
    }
    expect(runs).toBe(3);
    expect(getJob(job.id)).toMatchObject({ status: "failed", error_code: "HANDLER_CRASH" });
    expect(requireVersion(versionId)).toMatchObject({ status: "failed", error_code: "HANDLER_CRASH" });
    // Nothing is picked up again.
    db().prepare("UPDATE jobs SET next_run_at = 0 WHERE id = ?").run(job.id);
    scheduler.tick();
    await settle();
    expect(runs).toBe(3);
    await scheduler.stop(100);
  });
});

describe("retry after a billing failure (reliability audit #1)", () => {
  it("re-queues every failed or canceled scene, so compose can still start", () => {
    const { versionId } = createAd({ name: "retry-all", templateKey: "product_showcase", platform: "instagram_reels" });
    const t = Date.now();
    const scene = (pos: number, status: string) => {
      const id = `scn_${String(pos).padStart(20, "0")}`.slice(0, 24);
      db()
        .prepare(`INSERT INTO scenes (id, version_id, position, role, scene_type, prompt, duration_s, shows_product, visual_direction, motion_preset, creative_json, overlay_json, status) VALUES (?, ?, ?, 'r', 'ai_scene', 'p', 3, 0, 'v', 'fade-up', '{}', '{}', ?)`)
        .run(id, versionId, pos, status);
      return id;
    };
    const failed = scene(1, "failed");
    const canceled = scene(2, "canceled");
    const done = scene(3, "succeeded");
    for (const [id, status] of [[failed, "failed"], [canceled, "canceled"], [done, "succeeded"]] as const) {
      const j = enqueue({ type: "scene_generate", idempotencyKey: `scene:${id}:a1`, versionId, sceneId: id, input: { sceneId: id } });
      db().prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?").run(status, t, j.id);
    }
    db().prepare("UPDATE ad_versions SET status = 'failed' WHERE id = ?").run(versionId);

    expect(retryScene(versionId, failed)).toEqual({ requeued: 2 });
    const statuses = db().prepare("SELECT id, status FROM scenes WHERE version_id = ? ORDER BY position").all(versionId) as { id: string; status: string }[];
    expect(statuses.map((s) => s.status)).toEqual(["pending", "pending", "succeeded"]);
    expect(requireVersion(versionId).status).toBe("generating");
    const pendingJobs = db().prepare("SELECT scene_id FROM jobs WHERE version_id = ? AND status = 'pending' ORDER BY scene_id").all(versionId) as { scene_id: string }[];
    expect(pendingJobs.map((j) => j.scene_id).sort()).toEqual([failed, canceled].sort());
  });

  it("refuses to revive a canceled version", () => {
    const { versionId } = createAd({ name: "retry-canceled", templateKey: "product_showcase", platform: "instagram_reels" });
    db().prepare("UPDATE ad_versions SET status = 'canceled' WHERE id = ?").run(versionId);
    expect(() => retryScene(versionId, "scn_whatever")).toThrow(expect.objectContaining({ code: "VERSION_CANCELED", status: 409 }));
  });
});

describe("generate without a fal key (reliability audit #2)", () => {
  it("refuses up front when a live worker is in real mode with no key", async () => {
    const { versionId } = createAd({ name: "no-key", templateKey: "product_showcase", platform: "instagram_reels" });
    const t = Date.now();
    db().prepare("DELETE FROM workers").run();
    db()
      .prepare("INSERT INTO workers (id, instance_id, pid, started_at, heartbeat_at, lease_expires_at, mock_mode, fal_key_configured) VALUES (?, 'i-test', 1, ?, ?, ?, 0, 0)")
      .run(WORKER_ID, t, t, t + 60_000);
    try {
      await expect(startGenerate(versionId)).rejects.toMatchObject({ code: "FAL_KEY_MISSING", status: 409 });
      expect(requireVersion(versionId).status).toBe("draft");
    } finally {
      db().prepare("DELETE FROM workers").run();
    }
  });
});
