import "../guard";
import type { BriefInput, Category } from "@/lib/brief";
import type { PlatformKey } from "@/lib/platforms";

/**
 * Creative controls (plan §5 [v2.2]). Defaults come from a deterministic mapping of
 * category × tone × visual style × platform; the user can change every value per scene.
 * They shape the FOOTAGE only — the brand layer stays fixed.
 */

export const CAMERAS = ["static", "slow push-in", "pull-out", "orbit", "pan", "top-down", "handheld", "macro"] as const;
export const LIGHTING = ["soft studio", "natural daylight", "golden hour", "moody low-key", "high-key bright"] as const;
export const TRANSITIONS = ["cut", "crossfade", "dip_white", "dip_primary", "slide"] as const;
export const LAYOUTS = ["lower_third", "centered", "side_panel", "corner_badge", "split_headline"] as const;
export const PRODUCT_MOTIONS = ["push-in", "pan", "parallax", "rotate-in"] as const;
export const MOTION_PRESETS = ["fade-up", "slide-in", "scale-in", "logo-reveal"] as const;
export type Pacing = "calm" | "standard" | "fast";

export type Camera = (typeof CAMERAS)[number];
export type Lighting = (typeof LIGHTING)[number];
export type Transition = (typeof TRANSITIONS)[number];
export type Layout = (typeof LAYOUTS)[number];
export type ProductMotion = (typeof PRODUCT_MOTIONS)[number];
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export interface CreativeControls {
  camera: Camera;
  lighting: Lighting;
  setting: string;
  transitionOut: Transition;
  layoutVariant: Layout;
  productMotion: ProductMotion;
}

const CAMERA_BY_TONE: Record<BriefInput["creative"]["tone"], { product: Camera; scene: Camera }> = {
  premium: { product: "orbit", scene: "slow push-in" },
  friendly: { product: "slow push-in", scene: "handheld" },
  energetic: { product: "macro", scene: "handheld" },
  calm: { product: "slow push-in", scene: "static" },
  informative: { product: "top-down", scene: "static" },
};

const LIGHT_BY_STYLE: Record<BriefInput["creative"]["style"], Lighting> = {
  studio: "soft studio",
  lifestyle: "natural daylight",
  minimal: "high-key bright",
  bold: "moody low-key",
};

const SETTING_BY_CATEGORY: Record<Category, { product: string; scene: string }> = {
  fashion_accessories: { product: "a clean neutral surface with soft fabric texture", scene: "a bright town street{in}" },
  health_personal_care: { product: "a tidy bathroom shelf with soft towels", scene: "a calm, sunlit home{in}" },
  home_kitchen: { product: "a modern kitchen counter", scene: "a busy, warm family kitchen{in}" },
  office_stationery: { product: "a tidy wooden office desk", scene: "a bright small office or study corner" },
};

export const CATEGORY_NOUN: Record<Category, string> = {
  fashion_accessories: "fashion accessory",
  health_personal_care: "personal care product",
  home_kitchen: "kitchen item",
  office_stationery: "office or study item",
};

export const TONE_MOOD: Record<BriefInput["creative"]["tone"], string> = {
  premium: "Premium, refined mood",
  friendly: "Warm, friendly mood",
  energetic: "Energetic, upbeat mood",
  calm: "Calm, gentle mood",
  informative: "Clear, straightforward mood",
};

export function defaultPacing(brief: BriefInput): Pacing {
  if (brief.creative.tone === "calm" || brief.creative.tone === "premium") return "calm";
  if (brief.creative.tone === "energetic") return "fast";
  return "standard";
}

export const TRANSITION_SECONDS: Record<Pacing, number> = { calm: 0.6, standard: 0.4, fast: 0.25 };

export function defaultTransition(pacing: Pacing, index: number): Transition {
  if (pacing === "fast") return index === 0 ? "dip_white" : "cut";
  return "crossfade";
}

export function transitionSeconds(t: Transition, pacing: Pacing): number {
  if (t === "cut") return 0;
  return TRANSITION_SECONDS[pacing];
}

/** Role-specific pacing multipliers: durations are re-weighted, the total never changes (F2). */
export const PACING_WEIGHT: Record<Pacing, Partial<Record<string, number>>> = {
  calm: { hook: 1.15, cta: 1.1 },
  standard: {},
  fast: { hook: 0.8, cta: 0.85, use_moment: 1.1 },
};

export function defaultControls(args: {
  brief: BriefInput;
  platform: PlatformKey;
  sceneType: string;
  showsProduct: boolean;
  layout: Layout;
  productMotion?: ProductMotion;
  pacing: Pacing;
  index: number;
}): CreativeControls {
  const { brief } = args;
  const cam = CAMERA_BY_TONE[brief.creative.tone];
  // Settings take the audience's place (first part of "Kochi, Kerala, India" → " in Kochi").
  const place = brief.audience.location?.split(",")[0]?.trim();
  const at = (s: string) => s.replace("{in}", place ? ` in ${place}` : "");
  const base = SETTING_BY_CATEGORY[brief.product.category];
  const settings = { product: at(base.product), scene: at(base.scene) };
  const studio = brief.creative.style === "studio" || brief.creative.style === "minimal";
  let layout = args.layout;
  if (layout === "side_panel" && args.platform !== "youtube_instream") layout = "lower_third";
  return {
    camera: args.showsProduct ? cam.product : cam.scene,
    lighting: LIGHT_BY_STYLE[brief.creative.style],
    setting: args.showsProduct && studio ? "a plain studio backdrop in soft blue-grey tones" : args.showsProduct ? settings.product : settings.scene,
    transitionOut: defaultTransition(args.pacing, args.index),
    layoutVariant: layout,
    productMotion: args.productMotion ?? "push-in",
  };
}

export function describeCamera(c: Camera): string {
  return {
    static: "Locked-off static camera",
    "slow push-in": "Slow, smooth camera push-in",
    "pull-out": "Slow camera pull-out",
    orbit: "Smooth partial orbit around the subject",
    pan: "Gentle horizontal camera pan",
    "top-down": "Top-down overhead camera",
    handheld: "Natural handheld camera movement",
    macro: "Macro lens close-up with shallow depth of field",
  }[c];
}

export function describeLighting(l: Lighting): string {
  return {
    "soft studio": "Soft, even studio lighting",
    "natural daylight": "Natural daylight",
    "golden hour": "Warm golden-hour light",
    "moody low-key": "Moody low-key lighting with deep shadows",
    "high-key bright": "Bright high-key lighting",
  }[l];
}
