import "../guard";
import { db, tx } from "../db";
import { newId, now } from "../util";
import {
  assertStageTransition,
  assertStatusTransition,
  initialStage,
  TERMINAL,
  type JobStatus,
  type JobType,
} from "./states";

export interface JobRow {
  id: string;
  type: JobType;
  version_id: string | null;
  scene_id: string | null;
  status: JobStatus;
  stage: string;
  priority: number;
  attempt: number;
  max_attempts: number;
  next_run_at: number;
  idempotency_key: string;
  lease_owner: string | null;
  lease_expires_at: number | null;
  heartbeat_at: number | null;
  fal_endpoint: string | null;
  fal_request_id: string | null;
  submit_state: "none" | "submitting" | "submitted" | null;
  submit_started_at: number | null;
  input_json: string;
  result_json: string | null;
  progress: number | null;
  queue_position: number | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: number;
  created_at: number;
  updated_at: number;
}

export const DEFAULT_LEASE_MS = 60_000;

export interface EnqueueInput {
  type: JobType;
  idempotencyKey: string;
  versionId?: string | null;
  sceneId?: string | null;
  input?: unknown;
  priority?: number;
  maxAttempts?: number;
  runAt?: number;
}

/** Idempotent: a second enqueue with the same key returns the existing job unchanged. */
export function enqueue(job: EnqueueInput): JobRow {
  const t = now();
  const id = newId("job");
  db()
    .prepare(
      `INSERT INTO jobs (id, type, version_id, scene_id, status, stage, priority, attempt, max_attempts, next_run_at,
         idempotency_key, submit_state, input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?, ?, 'none', ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .run(
      id, job.type, job.versionId ?? null, job.sceneId ?? null, initialStage(job.type), job.priority ?? 100,
      job.maxAttempts ?? 3, job.runAt ?? t, job.idempotencyKey, JSON.stringify(job.input ?? {}), t, t,
    );
  const row = getJobByKey(job.idempotencyKey)!;
  if (row.id === id) logEvent(row.id, null, "pending", row.stage, "enqueued");
  return row;
}

export function getJob(id: string): JobRow | undefined {
  return db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}

export function getJobByKey(key: string): JobRow | undefined {
  return db().prepare("SELECT * FROM jobs WHERE idempotency_key = ?").get(key) as JobRow | undefined;
}

export function logEvent(jobId: string, from: string | null, to: string | null, stage: string | null, message: string, data?: unknown): void {
  db()
    .prepare("INSERT INTO job_events (job_id, at, from_status, to_status, stage, message, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(jobId, now(), from, to, stage, message, data === undefined ? null : JSON.stringify(data));
}

/**
 * Claims the next runnable job of `type` for `owner` under a lease (plan §5). Claimable:
 * pending/retry_wait/blocked_disk that are due, running jobs whose lease expired (crash
 * recovery), and any non-terminal job with a cancel request so the handler can clean up.
 */
export function claimNext(type: JobType, owner: string, leaseMs = DEFAULT_LEASE_MS, at = now()): JobRow | undefined {
  return tx(() => {
    const candidate = db()
      .prepare(
        `SELECT * FROM jobs
         WHERE type = ?
           AND (
             (status IN ('pending','retry_wait','blocked_disk') AND next_run_at <= ?)
             OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?))
           )
         ORDER BY cancel_requested DESC, priority ASC, created_at ASC
         LIMIT 1`,
      )
      .get(type, at, at) as JobRow | undefined;
    if (!candidate) return undefined;
    const reclaimed = candidate.status === "running";
    db()
      .prepare(
        `UPDATE jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(owner, at + leaseMs, at, at, candidate.id);
    logEvent(candidate.id, candidate.status, "running", candidate.stage, reclaimed ? "reclaimed after expired lease" : "claimed", { owner });
    return getJob(candidate.id);
  });
}

/** Extends the lease; returns false if this owner no longer holds it (another worker reclaimed it). */
export function renewLease(jobId: string, owner: string, leaseMs = DEFAULT_LEASE_MS, at = now()): boolean {
  const r = db()
    .prepare(`UPDATE jobs SET lease_expires_at = ?, heartbeat_at = ? WHERE id = ? AND lease_owner = ? AND status = 'running'`)
    .run(at + leaseMs, at, jobId, owner);
  return r.changes === 1;
}

export interface TransitionPatch {
  status?: JobStatus;
  stage?: string;
  message: string;
  data?: unknown;
  nextRunAt?: number;
  attempt?: number;
  falEndpoint?: string | null;
  falRequestId?: string | null;
  submitState?: JobRow["submit_state"];
  submitStartedAt?: number | null;
  resultJson?: unknown;
  progress?: number | null;
  queuePosition?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease lost for job ${jobId}`);
    this.name = "LeaseLostError";
  }
}

/**
 * The single place job rows change (plan §3): validates status + stage transitions, requires the
 * caller to hold the lease, writes the row and a job_events record in one transaction.
 */
export function transition(jobId: string, owner: string, patch: TransitionPatch): JobRow {
  return tx(() => {
    const job = getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.lease_owner !== owner || job.status !== "running") throw new LeaseLostError(jobId);
    const status = patch.status ?? job.status;
    const stage = patch.stage ?? job.stage;
    if (status !== job.status) assertStatusTransition(job.status, status);
    if (stage !== job.stage) assertStageTransition(job.type, job.stage, stage);
    const releasing = status !== "running";
    const sets: string[] = ["status = ?", "stage = ?", "updated_at = ?"];
    const vals: unknown[] = [status, stage, now()];
    const add = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (releasing) {
      add("lease_owner", null);
      add("lease_expires_at", null);
    }
    if (patch.nextRunAt !== undefined) add("next_run_at", patch.nextRunAt);
    if (patch.attempt !== undefined) add("attempt", patch.attempt);
    if (patch.falEndpoint !== undefined) add("fal_endpoint", patch.falEndpoint);
    if (patch.falRequestId !== undefined) add("fal_request_id", patch.falRequestId);
    if (patch.submitState !== undefined) add("submit_state", patch.submitState);
    if (patch.submitStartedAt !== undefined) add("submit_started_at", patch.submitStartedAt);
    if (patch.resultJson !== undefined) add("result_json", JSON.stringify(patch.resultJson));
    if (patch.progress !== undefined) add("progress", patch.progress);
    if (patch.queuePosition !== undefined) add("queue_position", patch.queuePosition);
    if (patch.errorCode !== undefined) add("error_code", patch.errorCode);
    if (patch.errorMessage !== undefined) add("error_message", patch.errorMessage);
    vals.push(jobId);
    db().prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    logEvent(jobId, job.status, status, stage, patch.message, patch.data);
    return getJob(jobId)!;
  });
}

/** Graceful shutdown: hand running jobs back without changing their stage (resume later). */
export function releaseAll(owner: string): number {
  return tx(() => {
    const rows = db().prepare("SELECT id, stage FROM jobs WHERE lease_owner = ? AND status = 'running'").all(owner) as { id: string; stage: string }[];
    for (const r of rows) {
      db().prepare("UPDATE jobs SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(now(), r.id);
      logEvent(r.id, "running", "pending", r.stage, "released on worker shutdown");
    }
    return rows.length;
  });
}

export function countRunning(type: JobType, owner: string): number {
  const r = db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = ? AND lease_owner = ? AND status = 'running'").get(type, owner) as { n: number };
  return r.n;
}

/** Marks every non-terminal job of a version for cancellation; handlers do the actual cleanup. */
export function requestCancel(versionId: string): number {
  return tx(() => {
    const t = now();
    const pendingOnly = db()
      .prepare("SELECT id, status, stage FROM jobs WHERE version_id = ? AND status IN ('pending','retry_wait','blocked_disk') AND (submit_state IS NULL OR submit_state = 'none')")
      .all(versionId) as { id: string; status: JobStatus; stage: string }[];
    for (const j of pendingOnly) {
      db().prepare("UPDATE jobs SET status = 'canceled', cancel_requested = 1, updated_at = ? WHERE id = ?").run(t, j.id);
      logEvent(j.id, j.status, "canceled", j.stage, "canceled before start");
    }
    const r = db()
      .prepare(`UPDATE jobs SET cancel_requested = 1, next_run_at = MIN(next_run_at, ?), updated_at = ? WHERE version_id = ? AND status NOT IN ('succeeded','failed','canceled')`)
      .run(t, t, versionId);
    return pendingOnly.length + r.changes;
  });
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.has(status);
}
