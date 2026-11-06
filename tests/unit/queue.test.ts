import { describe, it, expect } from "vitest";
import { enqueue, claimNext, renewLease, transition, releaseAll, requestCancel, getJob, LeaseLostError } from "@/server/jobs/queue";
import { TransitionError, assertStageTransition, assertStatusTransition } from "@/server/jobs/states";
import { db } from "@/server/db";

let n = 0;
const key = () => `test:${++n}`;

describe("job queue", () => {
  it("enqueue is idempotent by key", () => {
    const k = key();
    const a = enqueue({ type: "maintenance", idempotencyKey: k });
    const b = enqueue({ type: "maintenance", idempotencyKey: k, priority: 1 });
    expect(b.id).toBe(a.id);
    expect(b.priority).toBe(100);
  });

  it("claims under a lease and reclaims after the lease expires (crash recovery)", () => {
    const j = enqueue({ type: "qa", idempotencyKey: key() });
    const t0 = Date.now() - 10_000_000 + 1000;
    const claimed = claimNext("qa", "worker-a", 60_000, t0 + 10_000_000);
    expect(claimed?.id).toBe(j.id);
    expect(claimNext("qa", "worker-b", 60_000, t0 + 10_000_000 + 1000)).toBeUndefined();
    const reclaimed = claimNext("qa", "worker-b", 60_000, t0 + 10_000_000 + 61_000);
    expect(reclaimed?.id).toBe(j.id);
    expect(reclaimed?.lease_owner).toBe("worker-b");
    expect(renewLease(j.id, "worker-a")).toBe(false);
    expect(() => transition(j.id, "worker-a", { status: "succeeded", stage: "done", message: "x" })).toThrow(LeaseLostError);
    const events = db().prepare("SELECT message FROM job_events WHERE job_id = ? ORDER BY id").all(j.id) as { message: string }[];
    expect(events.map((e) => e.message)).toContain("reclaimed after expired lease");
  });

  it("rejects illegal status and stage transitions (U4)", () => {
    const j = enqueue({ type: "scene_generate", idempotencyKey: key() });
    claimNext("scene_generate", "w");
    transition(j.id, "w", { stage: "submitting", message: "submit" });
    expect(() => transition(j.id, "w", { stage: "done", status: "succeeded", message: "skip" })).not.toThrow();
    expect(() => assertStageTransition("scene_generate", "downloading", "in_queue")).toThrow(TransitionError);
    expect(() => assertStageTransition("scene_generate", "validating", "downloading")).not.toThrow();
    expect(() => assertStageTransition("compose", "encoding", "bogus")).toThrow(TransitionError);
    expect(() => assertStatusTransition("succeeded", "running")).toThrow(TransitionError);
    expect(() => assertStatusTransition("canceled", "pending")).toThrow(TransitionError);
  });

  it("releases running jobs on shutdown without losing their stage", () => {
    const j = enqueue({ type: "compose", idempotencyKey: key() });
    claimNext("compose", "w2");
    transition(j.id, "w2", { stage: "encoding", message: "encoding" });
    expect(releaseAll("w2")).toBe(1);
    const after = getJob(j.id)!;
    expect(after.status).toBe("pending");
    expect(after.stage).toBe("encoding");
    expect(after.lease_owner).toBeNull();
  });

  it("cancels unstarted jobs immediately and flags running ones", () => {
    const t = Date.now();
    db().prepare("INSERT INTO brand_kits (id,name,created_at,updated_at) VALUES ('b','B',?,?)").run(t, t);
    db().prepare("INSERT INTO brand_kit_revisions (id,brand_kit_id,number,tokens_json,created_at) VALUES ('r','b',1,'{}',?)").run(t);
    db().prepare("INSERT INTO ads (id,name,brand_kit_id,created_at,updated_at) VALUES ('ad','A','b',?,?)").run(t, t);
    db().prepare("INSERT INTO ad_versions (id,ad_id,number,status,settings_json,finishing_json,platform,brand_revision_id,created_at,updated_at) VALUES ('v','ad',1,'generating','{}','{}','instagram_reels','r',?,?)").run(t, t);
    const a = enqueue({ type: "scene_generate", idempotencyKey: key(), versionId: "v" });
    const b = enqueue({ type: "scene_generate", idempotencyKey: key(), versionId: "v" });
    claimNext("scene_generate", "w3");
    requestCancel("v");
    const states = [getJob(a.id)!, getJob(b.id)!].map((j) => [j.status, j.cancel_requested]);
    expect(states).toContainEqual(["canceled", 1]);
    expect(states).toContainEqual(["running", 1]);
  });
});
