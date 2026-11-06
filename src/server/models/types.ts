import "../guard";
import { z } from "zod";
import type { Aspect } from "@/lib/platforms";

export type ModelId = "wan-3.0" | "minimax-h3-max-turbo" | "kling-v3-pro" | "seedance-2.0-mini" | "gemini-omni-flash-1.1";
export type Resolution = "480p" | "720p" | "1080p";
/** t2v = text only, i2v = start frame, ref = reference images (product consistency, plan §7). */
export type GenMode = "t2v" | "i2v" | "ref";

export type DurationSpec = { kind: "int-range"; min: number; max: number } | { kind: "number-range"; min: number; max: number };

export interface PricePeriod {
  /** Inclusive ISO dates; open-ended when omitted. */
  from?: string;
  until?: string;
  perSecond: Partial<Record<Resolution, number>>;
  /** Extra price per second when native audio is generated (e.g. Kling). */
  audioPerSecond?: Partial<Record<Resolution, number>>;
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
  referenceImageUrls?: string[];
  /** Provider-side prompt rewriting; off by default (Phase 0 decision). */
  promptExpansion?: boolean;
}

export interface ModelSpec {
  id: ModelId;
  label: string;
  summary: string;
  endpoints: Partial<Record<GenMode, string>>;
  durations: DurationSpec;
  resolutions: Resolution[];
  aspects: Aspect[];
  /** i2v output follows the start image's aspect (no aspect parameter). */
  i2vAspectFollowsImage: boolean;
  audio: "toggle" | "always" | "none";
  frames: { start: boolean; end: boolean };
  /** Reference images for product consistency; promptTag(i) is how prompts refer to image i (1-based). */
  references: { max: number; promptTag: (i: number) => string } | null;
  seed: boolean;
  /** Notes shown to users / in models-check (e.g. token-based pricing). */
  notes?: string;
  license: { type: "commercial"; verifiedAt: string };
  pricing: { verifiedAt: string; currency: "USD"; estimate?: boolean; periods: PricePeriod[]; modes?: Partial<Record<GenMode, PricePeriod[]>> };
  verifiedAt: string;
  retiresAt: string | null;
  buildInput(n: NormalizedInput): Record<string, unknown>;
  inputSchema: Partial<Record<GenMode, z.ZodType>>;
}

export const promptSchema = z.string().min(1).max(2000);
export const urlSchema = z.string().url();

/** Duration actually requested: smallest allowed value ≥ planned (the composer trims to exact). */
export function requestDuration(model: Pick<ModelSpec, "durations">, plannedS: number): number {
  const d = model.durations;
  if (d.kind === "int-range") return Math.min(d.max, Math.max(d.min, Math.ceil(plannedS - 1e-6)));
  return Math.min(d.max, Math.max(d.min, Math.round(plannedS * 100) / 100));
}

/** Negative prompt used where supported: the studio adds all text/logos itself (plan §4). */
export const NEGATIVE_PROMPT = "text, letters, captions, subtitles, logos, watermarks, brand names, blur, distortion, low quality";
