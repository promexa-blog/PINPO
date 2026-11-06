import "../guard";
import { z } from "zod";
import type { Aspect } from "@/lib/platforms";

/**
 * Typed fal model registry (plan §8). Every value here was verified against fal's OpenAPI
 * schema, llms.txt pricing and catalog on the `verifiedAt` date (docs/engineering/PHASE_0_FINDINGS.md).
 * `scripts/models-check.ts` re-verifies; never edit capabilities from memory.
 */

export type ModelId = "wan-3.0" | "minimax-h3-max-turbo";
export type Resolution = "480p" | "720p" | "1080p";
export type GenMode = "t2v" | "i2v";

export type DurationSpec = { kind: "int-range"; min: number; max: number } | { kind: "number-range"; min: number; max: number };

export interface PricePeriod {
  /** Inclusive ISO dates; open-ended when omitted. */
  from?: string;
  until?: string;
  perSecond: Record<Resolution, number>;
}

export interface NormalizedInput {
  mode: GenMode;
  prompt: string;
  durationS: number;
  resolution: Resolution;
  aspect: Aspect;
  audio: boolean;
  seed?: number;
  startImageUrl?: string;
  endImageUrl?: string;
  /** Provider-side prompt rewriting; off by default (Phase 0 decision). */
  promptExpansion?: boolean;
}

export interface ModelSpec {
  id: ModelId;
  label: string;
  summary: string;
  endpoints: Record<GenMode, string>;
  durations: DurationSpec;
  resolutions: Resolution[];
  aspects: Aspect[];
  /** i2v output follows the start image's aspect (no aspect parameter). */
  i2vAspectFollowsImage: boolean;
  audio: "toggle" | "none";
  frames: { start: boolean; end: boolean };
  references: null;
  seed: boolean;
  license: { type: "commercial"; verifiedAt: string };
  pricing: { verifiedAt: string; currency: "USD"; periods: PricePeriod[] };
  verifiedAt: string;
  retiresAt: string | null;
  buildInput(n: NormalizedInput): Record<string, unknown>;
  inputSchema: Record<GenMode, z.ZodType>;
}

const prompt = z.string().min(1).max(2000);
const url = z.string().url();

const wan: ModelSpec = {
  id: "wan-3.0",
  label: "Wan 3.0",
  summary: "Default all-rounder. 2–30s clips, 480p–1080p, optional native audio, start and end frames.",
  endpoints: { t2v: "alibaba/wan-3.0/text-to-video", i2v: "alibaba/wan-3.0/image-to-video" },
  durations: { kind: "int-range", min: 2, max: 30 },
  resolutions: ["480p", "720p", "1080p"],
  aspects: ["9:16", "16:9", "1:1"],
  i2vAspectFollowsImage: false,
  audio: "toggle",
  frames: { start: true, end: true },
  references: null,
  seed: true,
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: { verifiedAt: "2026-11-06", currency: "USD", periods: [{ perSecond: { "480p": 0.05, "720p": 0.1, "1080p": 0.2 } }] },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    const base: Record<string, unknown> = {
      prompt: n.prompt,
      duration: requestDuration(this, n.durationS),
      resolution: n.resolution,
      aspect_ratio: n.aspect,
      audio: n.audio,
      enable_prompt_expansion: n.promptExpansion ?? false,
      enable_safety_checker: true,
    };
    if (n.seed !== undefined) base.seed = n.seed;
    if (n.mode === "i2v") {
      if (!n.startImageUrl) throw new Error("Wan image-to-video needs a start image");
      base.start_image_url = n.startImageUrl;
      if (n.endImageUrl) base.end_image_url = n.endImageUrl;
    }
    return base;
  },
  inputSchema: {
    t2v: z
      .object({
        prompt,
        duration: z.number().int().min(2).max(30),
        resolution: z.enum(["480p", "720p", "1080p"]),
        aspect_ratio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
        audio: z.boolean(),
        enable_prompt_expansion: z.boolean(),
        enable_safety_checker: z.boolean(),
        seed: z.number().int().optional(),
      })
      .strict(),
    i2v: z
      .object({
        prompt,
        duration: z.number().int().min(2).max(30),
        resolution: z.enum(["480p", "720p", "1080p"]),
        aspect_ratio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
        audio: z.boolean(),
        enable_prompt_expansion: z.boolean(),
        enable_safety_checker: z.boolean(),
        seed: z.number().int().optional(),
        start_image_url: url,
        end_image_url: url.optional(),
      })
      .strict(),
  },
};

const MINIMAX_RES: Record<Resolution, string> = { "480p": "480P", "720p": "768P", "1080p": "1080P" };

const minimax: ModelSpec = {
  id: "minimax-h3-max-turbo",
  label: "MiniMax H3 Max Turbo",
  summary: "Cheapest. Up to 15s, 480P/768P/1080P, start and end frames. No audio control (studio adds sound).",
  endpoints: { t2v: "minimax/h3-max-turbo/text-to-video", i2v: "minimax/h3-max-turbo/image-to-video" },
  durations: { kind: "number-range", min: 0.92, max: 15 },
  resolutions: ["480p", "720p", "1080p"],
  aspects: ["9:16", "16:9", "1:1"],
  i2vAspectFollowsImage: true,
  audio: "none",
  frames: { start: true, end: true },
  references: null,
  seed: true,
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: {
    verifiedAt: "2026-11-06",
    currency: "USD",
    periods: [
      // fal promotion "30% off standard rates" 2026-11-01 → 2026-11-15; 768P is our "720p" tier.
      { from: "2026-11-01", until: "2026-11-15", perSecond: { "480p": 0.0175, "720p": 0.028, "1080p": 0.056 } },
      { from: "2026-11-16", perSecond: { "480p": 0.025, "720p": 0.04, "1080p": 0.08 } },
    ],
  },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    const base: Record<string, unknown> = {
      prompt: n.prompt,
      prompt_expansion_mode: n.promptExpansion ? "balanced" : "disabled",
      duration: requestDuration(this, n.durationS),
      resolution: MINIMAX_RES[n.resolution],
      enable_safety_checker: true,
    };
    if (n.seed !== undefined) base.seed = n.seed;
    if (n.mode === "t2v") base.aspect_ratio = n.aspect;
    else {
      if (!n.startImageUrl) throw new Error("MiniMax image-to-video needs a start image");
      base.image_url = n.startImageUrl;
      if (n.endImageUrl) base.end_image_url = n.endImageUrl;
    }
    return base;
  },
  inputSchema: {
    t2v: z
      .object({
        prompt,
        prompt_expansion_mode: z.enum(["disabled", "fast", "balanced", "quality"]),
        duration: z.number().min(0.92).max(15),
        resolution: z.enum(["480P", "768P", "1080P"]),
        aspect_ratio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
        enable_safety_checker: z.boolean(),
        seed: z.number().int().optional(),
      })
      .strict(),
    i2v: z
      .object({
        prompt,
        prompt_expansion_mode: z.enum(["disabled", "fast", "balanced", "quality"]),
        duration: z.number().min(0.92).max(15),
        resolution: z.enum(["480P", "768P", "1080P"]),
        enable_safety_checker: z.boolean(),
        seed: z.number().int().optional(),
        image_url: url,
        end_image_url: url.optional(),
      })
      .strict(),
  },
};

export const MODELS: Record<ModelId, ModelSpec> = { "wan-3.0": wan, "minimax-h3-max-turbo": minimax };
export const DEFAULT_MODEL: ModelId = "wan-3.0";

export function getModel(id: string): ModelSpec {
  const m = MODELS[id as ModelId];
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
}

/**
 * Duration actually requested from fal for a planned clip length: the smallest allowed value
 * ≥ the planned length (the composer trims to the exact planned length).
 */
export function requestDuration(model: Pick<ModelSpec, "durations">, plannedS: number): number {
  const d = model.durations;
  if (d.kind === "int-range") return Math.min(d.max, Math.max(d.min, Math.ceil(plannedS - 1e-6)));
  return Math.min(d.max, Math.max(d.min, Math.round(plannedS * 100) / 100));
}

export function maxClipSeconds(model: ModelSpec): number {
  return model.durations.max;
}

/** Builds and validates the exact fal input for a model (zod, strict — unknown keys are a bug). */
export function buildValidatedInput(model: ModelSpec, n: NormalizedInput): Record<string, unknown> {
  const input = model.buildInput(n);
  return model.inputSchema[n.mode].parse(input) as Record<string, unknown>;
}

/** Client-safe description for GET /api/models. */
export function publicModel(m: ModelSpec) {
  return {
    id: m.id,
    label: m.label,
    summary: m.summary,
    durations: m.durations,
    resolutions: m.resolutions,
    aspects: m.aspects,
    audio: m.audio,
    frames: m.frames,
    pricing: m.pricing,
    verifiedAt: m.verifiedAt,
    retiresAt: m.retiresAt,
  };
}
