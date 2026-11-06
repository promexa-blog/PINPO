import "../guard";
import { wan3 } from "./entries/wan3";
import { minimaxH3 } from "./entries/minimax-h3";
import { klingV3 } from "./entries/kling-v3";
import { seedance2Mini } from "./entries/seedance2-mini";
import { geminiOmni } from "./entries/gemini-omni";
import type { GenMode, ModelId, ModelSpec, NormalizedInput } from "./types";

/**
 * Typed fal model registry (plan §8). Every entry was verified against fal's OpenAPI schema,
 * llms.txt pricing and catalog on its `verifiedAt` date. `npm run models:check` re-verifies;
 * never edit capabilities from memory.
 */

export * from "./types";

export const MODELS: Record<ModelId, ModelSpec> = {
  "wan-3.0": wan3,
  "minimax-h3-max-turbo": minimaxH3,
  "kling-v3-pro": klingV3,
  "seedance-2.0-mini": seedance2Mini,
  "gemini-omni-flash-1.1": geminiOmni,
};
export const DEFAULT_MODEL: ModelId = "wan-3.0";

export function getModel(id: string): ModelSpec {
  const m = MODELS[id as ModelId];
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
}

export function maxClipSeconds(model: ModelSpec): number {
  return model.durations.max;
}

/** Builds and validates the exact fal input for a model (zod, strict — unknown keys are a bug). */
export function buildValidatedInput(model: ModelSpec, n: NormalizedInput): Record<string, unknown> {
  const schema = model.inputSchema[n.mode];
  if (!schema || !model.endpoints[n.mode]) throw new Error(`${model.label} has no ${n.mode} mode`);
  return schema.parse(model.buildInput(n)) as Record<string, unknown>;
}

export function supportsMode(model: ModelSpec, mode: GenMode): boolean {
  return !!model.endpoints[mode] && !!model.inputSchema[mode];
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
    references: m.references ? { max: m.references.max } : null,
    pricing: { verifiedAt: m.pricing.verifiedAt, estimate: !!m.pricing.estimate, periods: m.pricing.periods },
    notes: m.notes ?? null,
    verifiedAt: m.verifiedAt,
    retiresAt: m.retiresAt,
  };
}
