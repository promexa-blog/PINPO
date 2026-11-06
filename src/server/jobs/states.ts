import "../guard";

export type JobType = "scene_generate" | "compose" | "qa" | "render_preview" | "maintenance";
export type JobStatus = "pending" | "running" | "retry_wait" | "blocked_disk" | "succeeded" | "failed" | "canceled";

export const TERMINAL: ReadonlySet<JobStatus> = new Set(["succeeded", "failed", "canceled"]);

/** High-level status transitions (plan §3). Anything else throws. */
const STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ["running", "canceled"],
  running: ["running", "pending", "retry_wait", "blocked_disk", "succeeded", "failed", "canceled"],
  retry_wait: ["running", "canceled"],
  blocked_disk: ["running", "pending", "canceled"],
  succeeded: [],
  failed: ["pending"], // explicit user retry creates a new attempt
  canceled: [],
};

/** Fine-grained stages per job type, in pipeline order. */
export const STAGES: Record<JobType, readonly string[]> = {
  scene_generate: ["preparing", "submitting", "in_queue", "in_progress", "downloading", "validating", "done"],
  compose: ["normalizing", "rendering_overlays", "encoding", "validating", "finalizing", "done"],
  qa: ["checking", "done"],
  render_preview: ["rendering", "done"],
  maintenance: ["running", "done"],
};

/** Allowed backward stage moves (besides moving forward or staying). */
const STAGE_BACKTRACK: Partial<Record<JobType, Record<string, readonly string[]>>> = {
  scene_generate: {
    validating: ["downloading", "preparing"], // re-download once, then regenerate (plan §5 retry table)
    downloading: ["preparing"],
    in_progress: ["preparing", "in_queue"],
    in_queue: ["preparing"],
    submitting: ["preparing"],
  },
  compose: {
    encoding: ["normalizing"],
    validating: ["normalizing"],
    finalizing: ["normalizing"],
    rendering_overlays: ["normalizing"],
  },
};

export function initialStage(type: JobType): string {
  return STAGES[type][0]!;
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

export function assertStatusTransition(from: JobStatus, to: JobStatus): void {
  if (!STATUS_TRANSITIONS[from].includes(to)) throw new TransitionError(`Illegal job status transition ${from} → ${to}`);
}

export function assertStageTransition(type: JobType, from: string, to: string): void {
  const order = STAGES[type];
  const fi = order.indexOf(from);
  const ti = order.indexOf(to);
  if (fi < 0 || ti < 0) throw new TransitionError(`Unknown stage for ${type}: ${fi < 0 ? from : to}`);
  if (ti >= fi) return;
  if (STAGE_BACKTRACK[type]?.[from]?.includes(to)) return;
  throw new TransitionError(`Illegal ${type} stage transition ${from} → ${to}`);
}
