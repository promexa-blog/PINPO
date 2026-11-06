import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { db, tx } from "@/server/db";
import { paths } from "@/server/paths";
import { brandForVersion } from "@/server/brand/kits";
import { renderProductCanvas, PRODUCT_CANVAS_SCALE } from "@/server/render/brand-render";
import { productClip } from "@/server/media/clips";
import { validateClip } from "@/server/media/validate";
import { getModel, buildValidatedInput, type Resolution } from "@/server/models/registry";
import { clipListPrice, deliveredListPrice, pricingVersion } from "@/server/models/pricing";
import { getProvider, ProviderError, type ProviderStatus } from "@/server/fal/provider";
import { absolutePath, getAsset, putFile } from "@/server/storage/assets";
import { isDiskFullError } from "@/server/storage/disk";
import { enqueue } from "@/server/jobs/queue";
import { addCost } from "@/server/jobs/costs";
import type { SceneJobInput } from "@/server/jobs/generate";
import { AppError, now } from "@/server/util";
import type { JobContext, JobHandler } from "../types";

const POLL_MS = () => Number(process.env.FAL_POLL_MS ?? (process.env.FAL_MOCK === "1" ? 400 : 5000));
const BACKOFF_MS = [10_000, 30_000, 90_000];
const SHORT_SIDE: Record<Resolution, number> = { "480p": 480, "720p": 720, "1080p": 1080 };

interface SceneState {
  startImageUrl?: string;
  referenceImageUrls?: string[];
  redownloaded?: boolean;
  lastStatus?: ProviderStatus["state"];
  file?: string;
}

const state = (ctx: JobContext): SceneState => (ctx.job.result_json ? (JSON.parse(ctx.job.result_json) as SceneState) : {});
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

export const sceneGenerateHandler: JobHandler = {
  type: "scene_generate",
  concurrency: () => Number(process.env.FAL_MAX_IN_FLIGHT ?? 4),
  async run(ctx) {
    const input = JSON.parse(ctx.job.input_json) as SceneJobInput;
    if (ctx.job.cancel_requested) return cancel(ctx, input);
    if (input.sceneType === "product_original") return runLocal(ctx, input);
    return runAi(ctx, input);
  },
};

// ---------------- original-product scenes (no AI, plan §7) ----------------

async function runLocal(ctx: JobContext, input: SceneJobInput): Promise<void> {
  const brand = brandForVersion(ctx.job.version_id!);
  const dir = path.join(paths.work, `${ctx.job.id}-a${ctx.job.attempt}`);
  await mkdir(dir, { recursive: true });
  try {
    const canvas = await renderProductCanvas({ brand, platform: input.platform, productAssetId: input.productAssetId!, outFile: path.join(dir, "canvas.png") });
    const out = path.join(dir, "product.mp4");
    ctx.transition({ stage: "in_progress", message: "animating original product photo" });
    await productClip(canvas.file, out, { width: input.width, height: input.height, durationS: input.durationS, motion: input.productMotion, canvasScale: PRODUCT_CANVAS_SCALE }, { signal: ctx.signal });
    ctx.transition({ stage: "validating", message: "validating product clip" });
    const v = await validateClip(out, { requestedS: input.durationS, minShortSide: Math.min(input.width, input.height), expectAudio: null }, { signal: ctx.signal });
    if (!v.ok) throw new AppError("CLIP_INVALID", v.checks.filter((c) => c.status === "fail").map((c) => c.message).join("; "), 500);
    const product = getAsset(input.productAssetId!)!;
    const asset = await putFile(out, {
      kind: "video",
      mime: "video/mp4",
      ext: "mp4",
      source: "rendered",
      width: input.width,
      height: input.height,
      durationS: v.info?.durationS ?? input.durationS,
      provenance: {
        sourceType: "rendered",
        origin: `product_original from ${product.id} (${product.source_type ?? "unknown"})`,
        license: product.license ?? null,
        commercialUse: product.commercial_use,
        rightsHolder: product.rights_holder,
      },
    });
    succeed(ctx, input, asset.id, { motion: input.productMotion, canvasHash: canvas.inputHash });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    handleError(ctx, input, err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------- AI scenes ----------------

async function runAi(ctx: JobContext, input: SceneJobInput): Promise<void> {
  const provider = await getProvider();
  const model = getModel(input.modelId);
  const endpoint = input.endpoint!;
  try {
    for (;;) {
      const job = ctx.refresh();
      if (job.cancel_requested) return cancel(ctx, input);
      const st = state(ctx);
      switch (job.stage) {
        case "preparing": {
          let startImageUrl: string | undefined;
          let referenceImageUrls: string[] | undefined;
          if (input.mode === "ref") {
            // Original product photos as references (plan §7), uploaded unaltered.
            referenceImageUrls = [];
            for (const id of input.referenceAssetIds) {
              const a = getAsset(id);
              if (a) referenceImageUrls.push(await provider.uploadImage(await readFile(absolutePath(a)), a.mime));
            }
            if (!referenceImageUrls.length) throw new AppError("NO_REFERENCES", "No product reference images could be uploaded", 422);
          }
          if (input.mode === "i2v") {
            const brand = brandForVersion(job.version_id!);
            const dir = path.join(paths.work, `${job.id}-start`);
            await mkdir(dir, { recursive: true });
            // Start frame = the original photo composited unaltered at the exact target aspect.
            const frame = await renderProductCanvas({ brand, platform: input.platform, productAssetId: input.productAssetId!, outFile: path.join(dir, "start.png"), canvasScale: 1 });
            startImageUrl = await provider.uploadImage(await readFile(frame.file), "image/png");
            await rm(dir, { recursive: true, force: true });
          }
          ctx.transition({ stage: "submitting", message: input.mode === "i2v" ? "start frame uploaded" : input.mode === "ref" ? `${referenceImageUrls!.length} reference image(s) uploaded` : "inputs ready", resultJson: { ...st, startImageUrl, referenceImageUrls }, submitState: "none" });
          break;
        }
        case "submitting": {
          if (job.submit_state === "submitting" && !job.fal_request_id) {
            // Crash between submit and storing the request ID (plan §5, Phase 0 recovery rule).
            const started = job.submit_started_at ?? now();
            const found = await provider.findRequests(endpoint, started - 5_000, started + 120_000);
            const known = new Set((db().prepare("SELECT fal_request_id FROM jobs WHERE fal_request_id IS NOT NULL").all() as { fal_request_id: string }[]).map((r) => r.fal_request_id));
            const candidates = (found ?? []).filter((id) => !known.has(id));
            if (found && candidates.length === 1) {
              ctx.transition({ stage: "in_queue", submitState: "submitted", falRequestId: candidates[0]!, message: "recovered request after crash (single match)" });
              break;
            }
            const { usd } = clipListPrice(model, input.resolution, input.durationS, input.pricingDate, input.mode ?? "t2v", input.clipAudio);
            addCost({ kind: "exposure_duplicate", usd, versionId: input.versionId, jobId: job.id, sceneId: input.sceneId, attempt: job.attempt, possibleDuplicate: true, pricingVersion: pricingVersion(model, input.pricingDate), mock: provider.name === "mock", note: found ? `${candidates.length} unmatched requests in window` : "request lookup unavailable" });
            ctx.log("lost request after crash — resubmitting; possible duplicate charge recorded");
          }
          const falInput = buildValidatedInput(model, {
            mode: input.mode!,
            prompt: input.prompt,
            durationS: input.durationS,
            resolution: input.resolution,
            aspect: input.aspect,
            audio: input.clipAudio,
            seed: input.seed,
            startImageUrl: st.startImageUrl,
            referenceImageUrls: st.referenceImageUrls,
          });
          ctx.transition({ submitState: "submitting", submitStartedAt: now(), falEndpoint: endpoint, message: "submitting to fal" });
          const requestId = await provider.submit(endpoint, falInput);
          ctx.transition({ stage: "in_queue", submitState: "submitted", falRequestId: requestId, message: `submitted (${provider.name})`, data: { requestedS: falInput.duration } });
          break;
        }
        case "in_queue":
        case "in_progress": {
          const s = await provider.status(endpoint, job.fal_request_id!);
          if (s.state === "IN_QUEUE") {
            if (job.stage !== "in_queue" || job.queue_position !== s.queuePosition) ctx.transition({ stage: "in_queue", queuePosition: s.queuePosition, message: `waiting in fal queue${s.queuePosition !== null ? ` (position ${s.queuePosition})` : ""}`, resultJson: { ...st, lastStatus: s.state } });
            await sleep(POLL_MS(), ctx.signal);
            break;
          }
          if (s.state === "IN_PROGRESS") {
            if (job.stage !== "in_progress") ctx.transition({ stage: "in_progress", queuePosition: null, message: "generating", resultJson: { ...st, lastStatus: s.state } });
            await sleep(POLL_MS(), ctx.signal);
            break;
          }
          if (s.error) {
            const { usd } = clipListPrice(model, input.resolution, input.durationS, input.pricingDate, input.mode ?? "t2v", input.clipAudio);
            addCost({ kind: "exposure_failed", usd, versionId: input.versionId, jobId: job.id, sceneId: input.sceneId, attempt: job.attempt, falRequestId: job.fal_request_id, pricingVersion: pricingVersion(model, input.pricingDate), mock: provider.name === "mock", note: `fal reported: ${s.error}` });
            if (/content_policy/i.test(`${s.errorType} ${s.error}`)) throw new ProviderError("content_policy", "fal rejected this prompt or image under its content policy.");
            return regenerateOrFail(ctx, input, "RUNNER_FAILURE", `Generation failed on fal: ${s.error}`);
          }
          ctx.transition({ stage: "downloading", message: "generation complete", resultJson: { ...st, lastStatus: "COMPLETED" } });
          break;
        }
        case "downloading": {
          const url = await provider.resultVideoUrl(endpoint, job.fal_request_id!);
          await mkdir(paths.work, { recursive: true });
          const file = path.join(paths.work, `${job.id}-a${job.attempt}.mp4`);
          let lastErr: unknown;
          for (let i = 0; i < 5; i++) {
            try {
              await provider.download(url, file, ctx.signal);
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              if (isDiskFullError(err)) throw err;
              await sleep(1000 * (i + 1), ctx.signal);
            }
          }
          if (lastErr) throw lastErr;
          ctx.transition({ stage: "validating", message: "downloaded", resultJson: { ...st, file } });
          break;
        }
        case "validating": {
          const file = st.file!;
          const v = await validateClip(file, { requestedS: (JSON.parse(job.input_json) as SceneJobInput).requestedS, minShortSide: Math.round(SHORT_SIDE[input.resolution] * 0.95), expectAudio: input.clipAudio ? true : null }, { signal: ctx.signal });
          if (!v.ok) {
            const why = v.checks.filter((c) => c.status === "fail").map((c) => `${c.key}: ${c.message}`).join("; ");
            await rm(file, { force: true });
            if (!st.redownloaded) {
              ctx.transition({ stage: "downloading", message: `clip failed validation (${why}); downloading again`, resultJson: { ...st, redownloaded: true, file: undefined } });
              break;
            }
            const { usd } = clipListPrice(model, input.resolution, input.durationS, input.pricingDate, input.mode ?? "t2v", input.clipAudio);
            addCost({ kind: "exposure_failed", usd, versionId: input.versionId, jobId: job.id, sceneId: input.sceneId, attempt: job.attempt, falRequestId: job.fal_request_id, pricingVersion: pricingVersion(model, input.pricingDate), mock: provider.name === "mock", note: `delivered clip rejected: ${why}` });
            return regenerateOrFail(ctx, input, "CLIP_INVALID", `Delivered clip was invalid twice (${why}).`);
          }
          const delivered = v.info!.durationS;
          const asset = await putFile(file, {
            kind: "video",
            mime: "video/mp4",
            ext: "mp4",
            source: "generated",
            width: v.info!.video!.width,
            height: v.info!.video!.height,
            durationS: delivered,
            provenance: {
              sourceType: "generated_fal",
              origin: `${endpoint} request ${job.fal_request_id}`,
              license: `fal catalog license_type: ${model.license.type} (verified ${model.license.verifiedAt})`,
              commercialUse: model.license.type === "commercial" ? "yes" : "unknown",
              rightsHolder: `Generated for ${brandForVersion(job.version_id!).tokens.name} via fal.ai`,
            },
          });
          addCost({
            kind: "calculated",
            usd: provider.name === "mock" ? 0 : deliveredListPrice(model, input.resolution, delivered, input.pricingDate, input.mode ?? "t2v", input.clipAudio),
            versionId: input.versionId,
            jobId: job.id,
            sceneId: input.sceneId,
            attempt: job.attempt,
            falRequestId: job.fal_request_id,
            mock: provider.name === "mock",
            pricingVersion: pricingVersion(model, input.pricingDate),
            basis: { deliveredS: delivered, resolution: input.resolution },
          });
          return succeed(ctx, input, asset.id, { falRequestId: job.fal_request_id, deliveredS: delivered });
        }
        default:
          throw new Error(`Unexpected stage ${job.stage}`);
      }
    }
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    handleError(ctx, input, err);
  }
}

// ---------------- outcomes ----------------

function succeed(ctx: JobContext, input: SceneJobInput, clipAssetId: string, data: unknown): void {
  tx(() => {
    ctx.transition({ status: "succeeded", stage: "done", message: "scene ready", progress: 1, data });
    db().prepare("UPDATE scenes SET status = 'succeeded', clip_asset_id = ? WHERE id = ?").run(clipAssetId, input.sceneId);
    // Compose is enqueued in the SAME transaction as the last scene's success (plan §3) — never missed, never doubled.
    const pending = (db().prepare("SELECT COUNT(*) AS n FROM scenes WHERE version_id = ? AND status NOT IN ('succeeded','reused')").get(input.versionId) as { n: number }).n;
    const v = db().prepare("SELECT status FROM ad_versions WHERE id = ?").get(input.versionId) as { status: string };
    if (pending === 0 && v.status === "generating") {
      db().prepare("UPDATE ad_versions SET status = 'composing', updated_at = ? WHERE id = ?").run(now(), input.versionId);
      enqueue({ type: "compose", idempotencyKey: `compose:${input.versionId}`, versionId: input.versionId, input: { versionId: input.versionId }, priority: 20, maxAttempts: 2 });
    }
  });
}

function regenerateOrFail(ctx: JobContext, input: SceneJobInput, code: string, message: string): void {
  const job = ctx.refresh();
  if (job.attempt < job.max_attempts) {
    ctx.transition({
      status: "retry_wait",
      stage: "preparing",
      attempt: job.attempt + 1,
      nextRunAt: now() + (process.env.FAL_MOCK === "1" ? 200 : BACKOFF_MS[job.attempt - 1] ?? 90_000),
      falRequestId: null,
      submitState: "none",
      submitStartedAt: null,
      resultJson: {},
      errorCode: code,
      errorMessage: message,
      message: `${message} Retrying (attempt ${job.attempt + 1} of ${job.max_attempts}).`,
    });
    return;
  }
  fail(ctx, input, code, message);
}

function fail(ctx: JobContext, input: SceneJobInput, code: string, message: string): void {
  tx(() => {
    ctx.transition({ status: "failed", errorCode: code, errorMessage: message, message });
    db().prepare("UPDATE scenes SET status = 'failed' WHERE id = ?").run(input.sceneId);
    db().prepare("UPDATE ad_versions SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND status IN ('generating','queued')").run(code, `Scene ${input.position + 1}: ${message}`, now(), input.versionId);
  });
}

/** Retry policy (plan §5): retryable errors back off; policy/validation/auth/balance fail immediately. */
function handleError(ctx: JobContext, input: SceneJobInput, err: unknown): void {
  const job = ctx.refresh();
  if (isDiskFullError(err)) {
    ctx.transition({ status: "blocked_disk", nextRunAt: now() + 60_000, errorCode: "DISK_FULL", errorMessage: "Disk is full", message: "paused: disk full — free space to resume" });
    return;
  }
  if (err instanceof ProviderError) {
    if (err.retryable) {
      if (job.attempt < job.max_attempts || job.stage === "in_queue" || job.stage === "in_progress" || job.stage === "downloading") {
        // Status polls / downloads don't create new generations, so they retry on the same attempt.
        const sameAttempt = ["in_queue", "in_progress", "downloading"].includes(job.stage);
        ctx.transition({
          status: "retry_wait",
          attempt: sameAttempt ? job.attempt : job.attempt + 1,
          nextRunAt: now() + BACKOFF_MS[Math.min(job.attempt - 1, 2)]! / (process.env.FAL_MOCK === "1" ? 50 : 1),
          errorCode: err.kind.toUpperCase(),
          errorMessage: err.message,
          message: `${err.message} — retrying`,
        });
        return;
      }
    }
    if (err.kind === "auth" || err.kind === "balance") {
      fail(ctx, input, err.kind.toUpperCase(), err.message);
      tx(() => {
        db().prepare("UPDATE jobs SET cancel_requested = 1 WHERE version_id = ? AND status NOT IN ('succeeded','failed','canceled')").run(input.versionId);
      });
      return;
    }
    return fail(ctx, input, err.kind.toUpperCase(), err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (job.attempt < job.max_attempts && !(err instanceof AppError && err.status < 500)) {
    ctx.transition({ status: "retry_wait", stage: "preparing", attempt: job.attempt + 1, nextRunAt: now() + 10_000, falRequestId: null, submitState: "none", resultJson: {}, errorCode: "ERROR", errorMessage: message, message: `${message} — retrying` });
    return;
  }
  fail(ctx, input, err instanceof AppError ? err.code : "ERROR", message);
}

async function cancel(ctx: JobContext, input: SceneJobInput): Promise<void> {
  const job = ctx.refresh();
  if (job.fal_request_id && ["in_queue", "in_progress"].includes(job.stage)) {
    const provider = await getProvider();
    const model = getModel(input.modelId);
    const st = state(ctx);
    let outcome: Awaited<ReturnType<typeof provider.cancel>> = "not_found";
    try {
      outcome = await provider.cancel(input.endpoint!, job.fal_request_id, st.lastStatus ?? null);
    } catch (err) {
      ctx.log(`cancel call failed: ${String(err)}`);
      outcome = "requested";
    }
    const { usd } = clipListPrice(model, input.resolution, input.durationS, input.pricingDate, input.mode ?? "t2v", input.clipAudio);
    addCost({
      kind: "exposure_canceled",
      usd: outcome === "removed" || provider.name === "mock" ? 0 : usd,
      versionId: input.versionId,
      jobId: job.id,
      sceneId: input.sceneId,
      attempt: job.attempt,
      falRequestId: job.fal_request_id,
      mock: provider.name === "mock",
      pricingVersion: pricingVersion(model, input.pricingDate),
      note: outcome === "removed" ? "removed from queue before running (not billed)" : `cancel ${outcome} — may still be billed`,
    });
  }
  tx(() => {
    ctx.transition({ status: "canceled", message: "canceled" });
    db().prepare("UPDATE scenes SET status = 'canceled' WHERE id = ? AND status <> 'succeeded'").run(input.sceneId);
  });
  await rm(path.join(paths.work, `${job.id}-a${job.attempt}.mp4`), { force: true });
}
