import "../guard";
import type { ModelSpec, Resolution, GenMode } from "../models/registry";
import { clipListPrice, pricingVersion, round4 } from "../models/pricing";
import type { SceneDraft } from "./storyboard";

export interface SceneEstimate {
  position: number;
  ai: boolean;
  requestedS: number;
  usd: number;
}

export interface Estimate {
  scenes: SceneEstimate[];
  totalUsd: number;
  pricingVersion: string;
  date: string;
  /** Plan §10: estimates are list prices, never billing data. */
  label: "Estimated";
}

/** "Estimated" cost (plan §10): list price × requested fal duration for AI scenes; local scenes cost $0. */
export function sceneMode(sceneType: SceneDraft["sceneType"]): GenMode | null {
  return sceneType === "product_original" ? null : sceneType === "ai_from_product" ? "i2v" : sceneType === "ai_reference" ? "ref" : "t2v";
}

export function estimateCost(scenes: Pick<SceneDraft, "position" | "sceneType" | "durationS">[], model: ModelSpec, resolution: Resolution, date: string, audio = false): Estimate {
  const out = scenes.map((s) => {
    const ai = s.sceneType !== "product_original";
    if (!ai) return { position: s.position, ai, requestedS: 0, usd: 0 };
    const { usd, requestedS } = clipListPrice(model, resolution, s.durationS, date, sceneMode(s.sceneType)!, audio);
    return { position: s.position, ai, requestedS, usd };
  });
  return { scenes: out, totalUsd: round4(out.reduce((a, s) => a + s.usd, 0)), pricingVersion: pricingVersion(model, date), date, label: "Estimated" };
}
