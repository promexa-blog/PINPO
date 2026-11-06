import "../guard";
import { db, tx } from "../db";
import { now } from "../util";

export const WORKER_ID = "primary";
export const WORKER_LEASE_MS = 60_000;
export const WORKER_HEARTBEAT_MS = 15_000;
/** UI shows "worker offline" when the last heartbeat is older than this. */
export const WORKER_OFFLINE_AFTER_MS = 40_000;

export interface WorkerRow {
  id: string;
  instance_id: string;
  pid: number;
  started_at: number;
  heartbeat_at: number;
  lease_expires_at: number;
  fal_key_configured: number;
  mock_mode: number;
  renderer_version: string | null;
  browser_pid: number | null;
  stopped_at: number | null;
}

export type AcquireResult = { ok: true } | { ok: false; holder: WorkerRow };

/** Single-instance guarantee (plan §5): a second worker fails to acquire while the first holds a live lease. */
export function acquireWorkerLease(instanceId: string, info: { falKeyConfigured: boolean; mockMode: boolean }, at = now()): AcquireResult {
  return tx(() => {
    const row = db().prepare("SELECT * FROM workers WHERE id = ?").get(WORKER_ID) as WorkerRow | undefined;
    if (row && row.instance_id !== instanceId && row.stopped_at === null && row.lease_expires_at > at) return { ok: false, holder: row };
    db()
      .prepare(
        `INSERT INTO workers (id, instance_id, pid, started_at, heartbeat_at, lease_expires_at, fal_key_configured, mock_mode, stopped_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET instance_id = excluded.instance_id, pid = excluded.pid, started_at = excluded.started_at,
           heartbeat_at = excluded.heartbeat_at, lease_expires_at = excluded.lease_expires_at,
           fal_key_configured = excluded.fal_key_configured, mock_mode = excluded.mock_mode, stopped_at = NULL,
           renderer_version = NULL, browser_pid = NULL`,
      )
      .run(WORKER_ID, instanceId, process.pid, at, at, at + WORKER_LEASE_MS, info.falKeyConfigured ? 1 : 0, info.mockMode ? 1 : 0);
    return { ok: true };
  });
}

export function heartbeat(instanceId: string, extra: { rendererVersion?: string | null; browserPid?: number | null } = {}, at = now()): boolean {
  const r = db()
    .prepare(
      `UPDATE workers SET heartbeat_at = ?, lease_expires_at = ?,
         renderer_version = COALESCE(?, renderer_version), browser_pid = ?
       WHERE id = ? AND instance_id = ? AND stopped_at IS NULL`,
    )
    .run(at, at + WORKER_LEASE_MS, extra.rendererVersion ?? null, extra.browserPid ?? null, WORKER_ID, instanceId);
  return r.changes === 1;
}

export function releaseWorkerLease(instanceId: string): void {
  db().prepare("UPDATE workers SET stopped_at = ?, lease_expires_at = 0, browser_pid = NULL WHERE id = ? AND instance_id = ?").run(now(), WORKER_ID, instanceId);
}

export function getWorker(): WorkerRow | undefined {
  return db().prepare("SELECT * FROM workers WHERE id = ?").get(WORKER_ID) as WorkerRow | undefined;
}

export function workerOnline(w: WorkerRow | undefined, at = now()): boolean {
  return !!w && w.stopped_at === null && at - w.heartbeat_at < WORKER_OFFLINE_AFTER_MS;
}
