import type { JobRow, TransitionPatch } from "@/server/jobs/queue";
import type { JobType } from "@/server/jobs/states";

export interface JobContext {
  job: JobRow;
  owner: string;
  /** Aborted on shutdown or when the job's lease is lost. */
  signal: AbortSignal;
  /** Re-reads the row (e.g. to notice cancel_requested). */
  refresh(): JobRow;
  transition(patch: TransitionPatch): JobRow;
  log(message: string, data?: unknown): void;
}

export interface JobHandler {
  type: JobType;
  /** Max jobs of this type this worker runs at once. */
  concurrency: () => number;
  run(ctx: JobContext): Promise<void>;
}
