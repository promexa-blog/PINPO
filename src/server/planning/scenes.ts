import "../guard";
import { FPS, toFrames } from "@/lib/platforms";
import type { ModelSpec } from "../models/registry";

/**
 * Splits the scene budget across scenes by weight (plan §4 step 2). AI scenes are snapped to
 * whole seconds when the model only accepts integers, and local (original-product) scenes absorb
 * the remainder, so nothing is wasted and the ad still hits its exact length.
 */

export interface PlanScene {
  weight: number;
  ai: boolean;
}

export const MIN_SCENE_S = 2;

export function allocateDurations(scenes: PlanScene[], budgetS: number, model: ModelSpec): number[] {
  const budgetF = toFrames(budgetS);
  const totalW = scenes.reduce((a, s) => a + s.weight, 0);
  const raw = scenes.map((s) => (s.weight / totalW) * budgetS);
  const d = model.durations;
  let durations = raw.slice();

  const localIdx = scenes.map((s, i) => (s.ai ? -1 : i)).filter((i) => i >= 0);
  if (d.kind === "int-range" && localIdx.length > 0) {
    const snapped = raw.map((r, i) => (scenes[i]!.ai ? Math.min(d.max, Math.max(d.min, Math.round(r))) : r));
    const aiSum = snapped.reduce((a, v, i) => a + (scenes[i]!.ai ? v : 0), 0);
    const localBudget = budgetS - aiSum;
    const localW = localIdx.reduce((a, i) => a + scenes[i]!.weight, 0);
    const local = localIdx.map((i) => (scenes[i]!.weight / localW) * localBudget);
    if (local.every((v) => v >= MIN_SCENE_S)) {
      durations = snapped.map((v, i) => (scenes[i]!.ai ? v : local[localIdx.indexOf(i)]!));
    }
  }
  // Clamp AI scenes to the model's maximum.
  durations = durations.map((v, i) => (scenes[i]!.ai ? Math.min(v, d.max) : v));

  // Whole frames; put the rounding residue on the last local scene (or the last scene).
  const frames = durations.map((v) => Math.max(toFrames(MIN_SCENE_S / 2), toFrames(v)));
  const residue = budgetF - frames.reduce((a, b) => a + b, 0);
  const absorb = localIdx.length ? localIdx[localIdx.length - 1]! : frames.length - 1;
  frames[absorb] = frames[absorb]! + residue;
  return frames.map((f) => f / FPS);
}
