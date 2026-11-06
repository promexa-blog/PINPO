import "../guard";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createFalClient, ApiError, ValidationError, type FalClient } from "@fal-ai/client";
import { ProviderError, type CancelOutcome, type ProviderStatus, type VideoProvider } from "./provider";

/** Real fal.ai provider. FAL_KEY is read here, in the worker process only (plan §1). */
export class FalProvider implements VideoProvider {
  readonly name = "fal" as const;
  private client: FalClient;
  private key: string;

  constructor() {
    const key = process.env.FAL_KEY?.trim();
    if (!key) throw new ProviderError("auth", "FAL_KEY is not set. Add it to .env.local, or set FAL_MOCK=1 for test clips.");
    this.key = key;
    this.client = createFalClient({ credentials: key });
  }

  async uploadImage(data: Buffer, mime: string): Promise<string> {
    return this.call(() => this.client.storage.upload(new Blob([new Uint8Array(data)], { type: mime }), { lifecycle: { expiresIn: "1d" } }));
  }

  async submit(endpoint: string, input: Record<string, unknown>): Promise<string> {
    const r = await this.call(() => this.client.queue.submit(endpoint, { input, storageSettings: { expiresIn: "7d" } }));
    return r.request_id;
  }

  async status(endpoint: string, requestId: string): Promise<ProviderStatus> {
    // The TS type lacks `error`/`error_type` on COMPLETED (Phase 0) — widen locally.
    const s = (await this.call(() => this.client.queue.status(endpoint, { requestId, logs: false }))) as {
      status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
      queue_position?: number;
      error?: string | null;
      error_type?: string | null;
    };
    if (s.status === "IN_QUEUE") return { state: "IN_QUEUE", queuePosition: s.queue_position ?? null };
    if (s.status === "IN_PROGRESS") return { state: "IN_PROGRESS" };
    if (s.error) return { state: "COMPLETED", error: s.error, errorType: s.error_type ?? null };
    return { state: "COMPLETED", error: null };
  }

  async resultVideoUrl(endpoint: string, requestId: string): Promise<string> {
    const r = (await this.call(() => this.client.queue.result(endpoint, { requestId }))) as { data: { video?: { url?: string } } };
    const url = r.data?.video?.url;
    if (!url) throw new ProviderError("unknown", "fal result has no video URL");
    return url;
  }

  async cancel(endpoint: string, requestId: string, lastKnown: ProviderStatus["state"] | null): Promise<CancelOutcome> {
    try {
      await this.client.queue.cancel(endpoint, { requestId });
      // The client hides 200 vs 202; a request still IN_QUEUE is removed (not billed), otherwise it may still run.
      return lastKnown === "IN_QUEUE" ? "removed" : "requested";
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) return "already_completed";
      if (err instanceof ApiError && err.status === 404) return "not_found";
      throw this.normalize(err);
    }
  }

  async download(url: string, dest: string, signal?: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      throw new ProviderError("network", `Download failed: ${(err as Error).message}`);
    }
    if (!res.ok || !res.body) throw new ProviderError(res.status >= 500 ? "server" : res.status === 404 ? "not_found" : "unknown", `Download failed with HTTP ${res.status}`, res.status);
    const tmp = `${dest}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmp), { signal });
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async findRequests(endpoint: string, fromMs: number, toMs: number): Promise<string[] | null> {
    // Platform API (Phase 0): GET /v1/models/requests/by-endpoint — needs `models:requests:read`.
    const url = new URL("https://api.fal.ai/v1/models/requests/by-endpoint");
    url.searchParams.set("endpoint_id", endpoint);
    url.searchParams.set("start", new Date(fromMs).toISOString());
    url.searchParams.set("end", new Date(toMs).toISOString());
    url.searchParams.set("limit", "100");
    try {
      const res = await fetch(url, { headers: { Authorization: `Key ${this.key}` } });
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, unknown>;
      const items = (body.items ?? body.requests ?? body.data) as { request_id?: string; id?: string }[] | undefined;
      if (!Array.isArray(items)) return null;
      return items.map((i) => i.request_id ?? i.id).filter((x): x is string => typeof x === "string");
    } catch {
      return null;
    }
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.normalize(err);
    }
  }

  private normalize(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    if (err instanceof ValidationError) {
      const detail = JSON.stringify(err.body ?? {});
      if (/content_policy/i.test(detail)) return new ProviderError("content_policy", "fal rejected this prompt or image under its content policy. Edit the scene and try again.", 422);
      return new ProviderError("validation", `fal rejected the request: ${detail.slice(0, 300)}`, 422);
    }
    if (err instanceof ApiError) {
      const body = JSON.stringify(err.body ?? {});
      if (/content_policy/i.test(body)) return new ProviderError("content_policy", "fal rejected this prompt or image under its content policy.", err.status);
      if (err.status === 401 || err.status === 403) return new ProviderError(/balance|credit|billing|payment/i.test(body) ? "balance" : "auth", `fal refused the request (${err.status}): check FAL_KEY and account balance.`, err.status);
      if (err.status === 402) return new ProviderError("balance", "fal account has insufficient balance.", 402);
      if (err.status === 429) return new ProviderError("rate_limit", "fal rate limit reached; will retry.", 429);
      if (err.status === 404) return new ProviderError("not_found", "fal request not found.", 404);
      if (err.status >= 500) return new ProviderError("server", `fal server error ${err.status}; will retry.`, err.status);
      return new ProviderError("unknown", `fal error ${err.status}: ${body.slice(0, 200)}`, err.status);
    }
    return new ProviderError("network", `Network error talking to fal: ${(err as Error)?.message ?? String(err)}`);
  }
}
