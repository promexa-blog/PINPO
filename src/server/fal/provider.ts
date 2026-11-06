import "../guard";

/** One interface for real fal.ai and the local mock (plan §5). Only the worker uses it. */

export type ProviderStatus =
  | { state: "IN_QUEUE"; queuePosition: number | null }
  | { state: "IN_PROGRESS" }
  | { state: "COMPLETED"; error: null }
  | { state: "COMPLETED"; error: string; errorType: string | null };

export type CancelOutcome = "removed" | "requested" | "already_completed" | "not_found";

export type ProviderErrorKind = "network" | "server" | "rate_limit" | "validation" | "content_policy" | "auth" | "balance" | "not_found" | "unknown";

/** Normalized provider error with a retry classification (plan §5 retry table). */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "server" || this.kind === "rate_limit";
  }
}

export interface VideoProvider {
  readonly name: "fal" | "mock";
  uploadImage(data: Buffer, mime: string): Promise<string>;
  submit(endpoint: string, input: Record<string, unknown>): Promise<string>;
  status(endpoint: string, requestId: string): Promise<ProviderStatus>;
  resultVideoUrl(endpoint: string, requestId: string): Promise<string>;
  cancel(endpoint: string, requestId: string, lastKnown: ProviderStatus["state"] | null): Promise<CancelOutcome>;
  download(url: string, dest: string, signal?: AbortSignal): Promise<void>;
  /**
   * Crash recovery (plan §5, Phase 0): request IDs for `endpoint` created in [fromMs, toMs].
   * Returns null when lookup isn't possible (then the caller resubmits and flags a duplicate).
   */
  findRequests(endpoint: string, fromMs: number, toMs: number): Promise<string[] | null>;
}

let cached: VideoProvider | null = null;

export async function getProvider(): Promise<VideoProvider> {
  if (cached) return cached;
  if (process.env.FAL_MOCK === "1") {
    const { MockProvider } = await import("./mock");
    cached = new MockProvider();
  } else {
    const { FalProvider } = await import("./real");
    cached = new FalProvider();
  }
  return cached;
}

export function __setProviderForTests(p: VideoProvider | null): void {
  cached = p;
}
