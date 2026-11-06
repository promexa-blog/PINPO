import "../guard";
import type { BriefInput, Lang } from "@/lib/brief";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import type { ModelSpec } from "../models/registry";
import { evaluateClaim, isEndorsementPrompt } from "../brief/claims";
import { offerLine, formatInr, formatDate } from "../brief/offers";
import { computeTimeline, sceneBudget, type Timeline } from "./timeline";
import { allocateDurations } from "./scenes";
import {
  CATEGORY_NOUN,
  defaultControls,
  describeCamera,
  describeLighting,
  PACING_WEIGHT,
  TONE_MOOD,
  transitionSeconds,
  type CreativeControls,
  type Layout,
  type MotionPreset,
  type Pacing,
} from "./creative";
import type { TemplateDef, TemplateSceneDef } from "./templates";

/** Rule-based storyboard: template × brief × platform × model → editable scenes (plan §4). No LLM. */

export type SceneType = TemplateSceneDef["sceneType"];

export type OverlayLineKind = "product_name" | "claim" | "offer_price" | "offer_mrp" | "offer_discount" | "offer_validity" | "group_price" | "group_min" | "group_deadline" | "tagline" | "brand_line" | "cta" | "placeholder";
export interface OverlayLine {
  kind: OverlayLineKind;
  text: string;
  claimId?: string;
}
export interface SceneOverlay {
  layout: Layout;
  motion: MotionPreset;
  byLang: Partial<Record<Lang, OverlayLine[]>>;
}

export interface SceneDraft {
  position: number;
  role: string;
  label: string;
  sceneType: SceneType;
  showsProduct: boolean;
  durationS: number;
  visualDirection: string;
  prompt: string;
  motionPreset: MotionPreset;
  creative: CreativeControls;
  overlay: SceneOverlay;
  productAssetId: string | null;
}

export interface ClaimRecord {
  id: string;
  position: number;
  language: Lang;
  text: string;
  confirmed: boolean;
  source?: string | null;
  substantiation?: string | null;
  attested: boolean;
  testimonialConsent: boolean;
}

export interface StoryboardInput {
  template: TemplateDef;
  brief: BriefInput;
  claims: ClaimRecord[];
  platform: PlatformKey;
  lengthS: number;
  pacing: Pacing;
  model: ModelSpec;
  outroS?: number;
  /** Brand copy from the ad's brand revision (tagline, group-buy line). */
  brandLines?: { tagline: string; groupBuyLine: string };
}

export interface Placeholder {
  scene: number;
  lang: Lang;
  message: string;
}

export interface Storyboard {
  scenes: SceneDraft[];
  timeline: Timeline;
  outroS: number;
  outroTransitionS: number;
  placeholders: Placeholder[];
  warnings: string[];
  /** Generate is blocked while placeholders remain (plan §4 step 6). */
  blocked: boolean;
}

export const OUTRO_S = 3;
export const OUTRO_TRANSITION_S = 0.5;
export const NO_TEXT_SUFFIX = "No on-screen text, captions, letters, logos, watermarks or brand names.";
const DEFAULT_CTA: Record<Lang, string | null> = { en: "Shop now", ml: null, hi: null };

export function buildStoryboard(input: StoryboardInput): Storyboard {
  const { template, brief, platform, lengthS, pacing, model } = input;
  if (!template.lengths.includes(lengthS)) throw new Error(`Template "${template.name}" supports ${template.lengths.join("/")}s, not ${lengthS}s.`);
  if (!PLATFORMS[platform].lengths.includes(lengthS)) throw new Error(`${PLATFORMS[platform].label} doesn't support ${lengthS}s ads.`);
  const outroS = input.outroS ?? OUTRO_S;
  const roles = template.scenes.filter((s) => s.minLengthS <= lengthS);
  const warnings: string[] = [];
  const placeholders: Placeholder[] = [];

  // Usable claims per language: confirmed and not failing compliance, in brief order.
  const usable: Record<Lang, ClaimRecord[]> = { en: [], ml: [], hi: [] };
  for (const c of [...input.claims].sort((a, b) => a.position - b.position)) {
    const verdict = evaluateClaim(c, brief.offers);
    if (verdict.status !== "fail") usable[c.language].push(c);
  }

  // Transitions and durations.
  const controls = roles.map((r, i) =>
    defaultControls({ brief, platform, sceneType: r.sceneType, showsProduct: r.showsProduct, layout: r.overlay.layout, productMotion: r.productMotion, pacing, index: i }),
  );
  const transitions = roles.map((_, i) => (i === roles.length - 1 ? OUTRO_TRANSITION_S : transitionSeconds(controls[i]!.transitionOut, pacing)));
  const budget = sceneBudget(lengthS, outroS, transitions);
  const durations = allocateDurations(
    roles.map((r) => ({ weight: r.weight * (PACING_WEIGHT[pacing][r.role] ?? 1), ai: r.sceneType !== "product_original" })),
    budget,
    model,
  );

  const offer = offerLine(brief.offers);
  const productImage = brief.product.imageAssetIds[0] ?? null;
  if (!productImage) warnings.push("Add at least one product photo — product scenes use the original photo.");

  const scenes: SceneDraft[] = roles.map((r, i) => {
    const c = controls[i]!;
    const byLang: SceneOverlay["byLang"] = {};
    for (const lang of brief.languages) {
      const lines = overlayLines(r.overlay.source, lang, { brief, usable, offer, brandLines: input.brandLines });
      for (const l of lines) if (l.kind === "placeholder") placeholders.push({ scene: i + 1, lang, message: l.text });
      byLang[lang] = lines;
    }
    // Plan §7: reference-capable endpoints first for AI product scenes.
    const sceneType: SceneType = r.sceneType === "ai_from_product" && model.references && model.endpoints.ref && brief.product.imageAssetIds.length ? "ai_reference" : r.sceneType;
    const prompt = sceneType === "product_original" ? "" : buildPrompt({ ...r, sceneType }, c, brief, model);
    if (prompt && isEndorsementPrompt(prompt)) throw new Error(`Scene ${i + 1} prompt asks for an endorsement or review, which isn't allowed.`);
    return {
      position: i,
      role: r.role,
      label: r.label,
      sceneType,
      showsProduct: r.showsProduct,
      durationS: durations[i]!,
      visualDirection: r.visualDirection,
      prompt,
      motionPreset: r.overlay.motion,
      creative: c,
      overlay: { layout: c.layoutVariant, motion: r.overlay.motion, byLang },
      productAssetId: r.showsProduct ? productImage : null,
    };
  });

  const timeline = computeTimeline({
    scenes: scenes.map((s, i) => ({ durationS: s.durationS, transitionOutS: transitions[i]! })),
    outroS,
  });
  if (Math.abs(timeline.totalS - lengthS) > 0.1) throw new Error(`Storyboard length ${timeline.totalS}s doesn't match ${lengthS}s`);
  return { scenes, timeline, outroS, outroTransitionS: OUTRO_TRANSITION_S, placeholders, warnings, blocked: placeholders.length > 0 || !productImage };
}

function overlayLines(
  source: string,
  lang: Lang,
  ctx: { brief: BriefInput; usable: Record<Lang, ClaimRecord[]>; offer: ReturnType<typeof offerLine>; brandLines?: { tagline: string; groupBuyLine: string } },
): OverlayLine[] {
  const { brief, usable, offer } = ctx;
  const cta = (): OverlayLine => {
    const text = brief.cta[lang]?.trim() || DEFAULT_CTA[lang];
    return text ? { kind: "cta", text } : { kind: "placeholder", text: `[Add the call to action in ${lang === "ml" ? "Malayalam" : lang === "hi" ? "Hindi" : "English"}]` };
  };
  const offerLines = (): OverlayLine[] => {
    if (!offer?.price) return [];
    const out: OverlayLine[] = [{ kind: "offer_price", text: offer.price }];
    if (offer.mrp) out.push({ kind: "offer_mrp", text: offer.mrp });
    if (offer.discount) out.push({ kind: "offer_discount", text: offer.discount });
    if (offer.validUntil) out.push({ kind: "offer_validity", text: offer.validUntil });
    return out;
  };
  if (source === "product_name") return [{ kind: "product_name", text: brief.product.name }];
  if (source === "tagline") return ctx.brandLines?.tagline ? [{ kind: "tagline", text: ctx.brandLines.tagline }] : [];
  if (source === "brand_line") return ctx.brandLines?.groupBuyLine ? [{ kind: "brand_line", text: ctx.brandLines.groupBuyLine }] : [];
  if (source === "group_buy") {
    const g = groupBuyLines(brief);
    return g.length ? [...g, cta()] : [{ kind: "placeholder", text: "[Add the group price, minimum buyers and deadline in Price & offer]" }];
  }
  if (source === "cta") return [cta()];
  if (source === "offer") return offerLines();
  if (source === "offer_or_cta") return [...offerLines(), cta()];
  const m = /^claim:(\d)$/.exec(source);
  if (m) {
    const claim = usable[lang][Number(m[1])];
    return claim
      ? [{ kind: "claim", text: claim.text, claimId: claim.id }]
      : [{ kind: "placeholder", text: `[Add confirmed benefit ${Number(m[1]) + 1}${lang === "en" ? "" : ` (${lang.toUpperCase()})`}]` }];
  }
  return [];
}

/** Group-buy lines generated only from brief values (plan §4, §9). */
export function groupBuyLines(brief: BriefInput): OverlayLine[] {
  const g = brief.offers.groupBuy;
  if (!g) return [];
  return [
    { kind: "group_price", text: formatInr(g.groupPriceInr) },
    { kind: "group_min", text: `Group price when ${g.minBuyers} people join` },
    { kind: "group_deadline", text: `Join by ${formatDate(g.deadline)}` },
  ];
}

function buildPrompt(r: TemplateSceneDef, c: CreativeControls, brief: BriefInput, model: ModelSpec): string {
  const scaffold = r.promptScaffold ?? "{appearance}. {camera}. {lighting}. Set on {setting}. {toneMood}.";
  const filled = scaffold
    .replaceAll("{appearance}", brief.product.appearance)
    .replaceAll("{camera}", describeCamera(c.camera))
    .replaceAll("{lighting}", describeLighting(c.lighting))
    .replaceAll("{setting}", c.setting)
    .replaceAll("{toneMood}", TONE_MOOD[brief.creative.tone])
    .replaceAll("{audienceWho}", brief.audience.who)
    .replaceAll("{audienceLocation}", brief.audience.location?.trim() || "their town")
    .replaceAll("{categoryNoun}", CATEGORY_NOUN[brief.product.category]);
  const parts = [filled];
  if (r.showsProduct && r.sceneType === "ai_reference" && model.references) {
    const n = Math.min(model.references.max, brief.product.imageAssetIds.length);
    const tags = Array.from({ length: n }, (_, k) => model.references!.promptTag(k + 1)).join(", ");
    parts.push(`The product is exactly the one shown in ${tags}: ${brief.product.appearance}. Keep its shape, colour, material, packaging and proportions identical to the reference.`);
  } else if (r.showsProduct) parts.push(`The product must look exactly like this: ${brief.product.appearance}. Keep its shape, colour, material, packaging and proportions identical to the start frame.`);
  if (brief.creative.direction.trim()) parts.push(`Creative direction: ${brief.creative.direction.trim()}.`);
  parts.push(NO_TEXT_SUFFIX);
  return parts.join(" ").replace(/\s+/g, " ").replace(/\.\./g, ".").trim();
}
