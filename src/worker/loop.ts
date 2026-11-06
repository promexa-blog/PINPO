import { claimNext, countRunning, getJob, logEvent, renewLease, transition, LeaseLostError, DEFAULT_LEASE_MS } from "@/server/jobs/queue";
import type { JobHandler, JobContext } from "./types";

const LEASE_RENEW_MS = 15_000;

export interface Scheduler {
  tick(): void;
  stop(graceMs: number): Promise<void>;
  active(): number;
}

/**
 * Claims due jobs per handler up to its concurrency and runs them with lease renewal (plan §5).
 * Errors that escape a handler release the job back to pending so it's retried, never lost.
 */
export function createScheduler(owner: string, handlers: JobHandler[], log: (msg: string, data?: unknown) => void): Scheduler {
  const running = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  let stopping = false;

  const runJob = (handler: JobHandler, jobId: string) => {
    const abort = new AbortController();
    const renew = setInterval(() => {
      if (!renewLease(jobId, owner, DEFAULT_LEASE_MS)) abort.abort(new LeaseLostError(jobId));
    }, LEASE_RENEW_MS);
    const ctx: JobContext = {
      get job() {
        return getJob(jobId)!;
      },
      owner,
      signal: abort.signal,
      refresh: () => getJob(jobId)!,
      transition: (patch) => transition(jobId, owner, patch),
      log: (message, data) => logEvent(jobId, null, null, getJob(jobId)?.stage ?? null, message, data),
    };
    const promise = handler
      .run(ctx)
      .catch((err: unknown) => {
        if (err instanceof LeaseLostError || abort.signal.aborted) return;
        log(`handler ${handler.type} crashed`, { jobId, error: String(err) });
        try {
          transition(jobId, owner, {
            status: "pending",
            message: "unexpected handler error; released for retry",
            errorCode: "HANDLER_CRASH",
            errorMessage: err instanceof Error ? err.message : String(err),
            nextRunAt: Date.now() + 10_000,
          });
        } catch {
          /* lease already gone */
        }
      })
      .finally(() => {
        clearInterval(renew);
        running.delete(jobId);
      });
    running.set(jobId, { promise, abort });
  };

  return {
    tick() {
      if (stopping) return;
      for (const handler of handlers) {
        let slots = handler.concurrency() - countRunning(handler.type, owner);
        while (slots-- > 0) {
          const job = claimNext(handler.type, owner);
          if (!job) break;
          if (running.has(job.id)) continue;
          runJob(handler, job.id);
        }
      }
    },
    async stop(graceMs) {
      stopping = true;
      const all = [...running.values()];
      await Promise.race([Promise.allSettled(all.map((r) => r.promise)), new Promise((r) => setTimeout(r, graceMs))]);
      for (const r of running.values()) r.abort.abort(new Error("worker shutdown"));
      // Bounded: a handler stuck in a non-abortable await must not block shutdown forever.
      await Promise.race([Promise.allSettled([...running.values()].map((r) => r.promise)), new Promise((r) => setTimeout(r, 5_000))]);
    },
    active: () => running.size,
  };
}
