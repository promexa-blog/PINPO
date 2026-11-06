import "../guard";
import type { SceneEdit } from "@/lib/version";
import { PLATFORMS } from "@/lib/platforms";
import { getModel, requestDuration } from "../models/registry";
import { getMasterBrand, readBundledTokens } from "../brand/master";
import { getTemplate } from "./templates";
import { buildStoryboard, OUTRO_S, OUTRO_TRANSITION_S, type ClaimRecord, type Storyboard } from "./storyboard";
import { computeTimeline, type Timeline } from "./timeline";
import { transitionSeconds, type Pacing } from "./creative";
import { estimateCost, type Estimate } from "./estimate";
import { getBrief, getScenes, requireVersion, sceneToEdit, settingsOf, finishingOf, writeScenes, getVoiceovers, type VersionRow } from "../db/repos/versions";
import { tx } from "../db";
import { complianceItems, type QaItem } from "../qa/checks/compliance";
import { indiaToday } from "../brief/offers";
import { AppError, sha256, stableStringify } from "../util";

/** Draft-level services: storyboard build/apply, timeline, estimate, pre-generate validation. */

export function claimRecords(versionId: string): ClaimRecord[] {
  const brief = getBrief(versionId);
  const pos: Record<string, number> = {};
  return brief.claims.map((c) => ({
    id: c.id!,
    position: (pos[c.language] = (pos[c.language] ?? -1) + 1),
    language: c.language,
    text: c.text,
    confirmed: c.confirmed,
    source: c.source,
    substantiation: c.substantiation,
    attested: c.attested,
    testimonialConsent: c.testimonialConsent,
  }));
}

export function storyboardFor(v: VersionRow): Storyboard {
  const settings = settingsOf(v);
  const template = getTemplate(settings.templateKey);
  if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Template not found", 404);
  return buildStoryboard({
    template,
    brief: getBrief(v.id),
    claims: claimRecords(v.id),
    platform: v.platform,
    lengthS: settings.lengthS,
    pacing: v.pacing,
    model: getModel(settings.modelId),
    brandLines: brandLines(),
  });
}

export function brandLines(): { tagline: string; groupBuyLine: string } {
  const t = getMasterBrand()?.tokens;
  return { tagline: t?.tagline ?? "Where demands connects.", groupBuyLine: t?.groupBuyLine ?? readBundledTokens().groupBuyLine ?? "" };
}

/** Hash of the generated content of a scene, to detect user edits (plan test S3). */
const genHash = (s: SceneEdit) => sha256(stableStringify({ ...s, id: undefined }));

export interface StoryboardDiff {
  applied: boolean;
  editedScenes: number[];
  storyboard: Storyboard;
}

export function applyStoryboard(versionId: string, confirm: boolean): StoryboardDiff {
  return tx(() => {
    const v = requireVersion(versionId);
    if (v.status !== "draft") throw new AppError("VERSION_LOCKED", "Only drafts can be re-storyboarded.", 423);
    const sb = storyboardFor(v);
    const existing = getScenes(versionId);
    const edited = existing
      .filter((s) => {
        const stored = (JSON.parse(s.creative_json) as { genHash?: string }).genHash;
        const current = sceneToEdit(s);
        // Scenes saved from the editor lose their genHash → treated as edited (conservative).
        return stored === undefined || stored !== genHash({ ...current, creative: stripMeta(current.creative) });
      })
      .map((s) => s.position + 1);
    if (edited.length && !confirm) return { applied: false, editedScenes: edited, storyboard: sb };
    const scenes: SceneEdit[] = sb.scenes.map((s) => ({
      role: s.role,
      label: s.label,
      sceneType: s.sceneType,
      showsProduct: s.showsProduct,
      durationS: s.durationS,
      visualDirection: s.visualDirection,
      prompt: s.prompt,
      motionPreset: s.motionPreset,
      creative: s.creative,
      overlay: s.overlay as SceneEdit["overlay"],
      productAssetId: s.productAssetId,
    }));
    writeScenes(
      versionId,
      scenes.map((s) => ({ ...s, creative: { ...s.creative, genHash: genHash(s) } as SceneEdit["creative"] })),
    );
    return { applied: true, editedScenes: edited, storyboard: sb };
  });
}

function stripMeta<T extends object>(c: T): T {
  const { genHash: _g, label: _l, ...rest } = c as Record<string, unknown>;
  return rest as T;
}

export function draftScenes(versionId: string): SceneEdit[] {
  return getScenes(versionId).map((s) => {
    const e = sceneToEdit(s);
    return { ...e, creative: stripMeta(e.creative) };
  });
}

export function timelineFor(scenes: Pick<SceneEdit, "durationS" | "creative">[], pacing: Pacing): Timeline {
  return computeTimeline({
    scenes: scenes.map((s, i) => ({ durationS: s.durationS, transitionOutS: i === scenes.length - 1 ? OUTRO_TRANSITION_S : transitionSeconds(s.creative.transitionOut, pacing) })),
    outroS: OUTRO_S,
  });
}

export interface DraftCheck {
  ok: boolean;
  blocking: QaItem[];
  warnings: QaItem[];
  timeline: Timeline | null;
  estimate: Estimate | null;
}

/** Everything that must be true before Generate (plan §4 step 6, §9, §12). */
export function checkDraft(versionId: string): DraftCheck {
  const v = requireVersion(versionId);
  const settings = settingsOf(v);
  const finishing = finishingOf(v);
  const brief = getBrief(versionId);
  const model = getModel(settings.modelId);
  const scenes = draftScenes(versionId);
  const blocking: QaItem[] = [];
  const warnings: QaItem[] = [];
  const add = (status: QaItem["status"], check: string, message: string) => (status === "fail" ? blocking : warnings).push({ check, method: "automated", status, message });

  if (!brief.product.name.trim()) add("fail", "brief", "Add the product name.");
  if (brief.product.appearance.trim().length < 10) add("fail", "brief", "Describe how the product looks (colour, material, size, packaging) — AI scenes must keep it exactly.");
  if (!brief.audience.who.trim()) add("fail", "brief", "Say who the ad is for.");
  if (!scenes.length) add("fail", "storyboard", "Build the storyboard first.");
  if (!PLATFORMS[v.platform].lengths.includes(settings.lengthS)) add("fail", "length", `${PLATFORMS[v.platform].label} doesn't support ${settings.lengthS}s ads.`);
  if (!model.resolutions.includes(settings.resolution)) add("fail", "model", `${model.label} doesn't offer ${settings.resolution}.`);
  if (!model.aspects.includes(PLATFORMS[v.platform].aspect)) add("fail", "model", `${model.label} doesn't support ${PLATFORMS[v.platform].aspect}.`);
  let timeline: Timeline | null = null;
  if (scenes.length) try {
    timeline = timelineFor(scenes, v.pacing);
    if (scenes.length && Math.abs(timeline.totalS - settings.lengthS) > 0.1) add("fail", "length", `Scenes add up to ${timeline.totalS.toFixed(1)}s but the ad is ${settings.lengthS}s. Adjust scene lengths or rebuild the storyboard.`);
  } catch (e) {
    add("fail", "timeline", (e as Error).message);
  }
  scenes.forEach((s, i) => {
    if (s.showsProduct && !s.productAssetId) add("fail", "product_image", `Scene ${i + 1} shows the product but has no product photo.`);
    if (s.sceneType !== "product_original") {
      if (!s.prompt.trim()) add("fail", "prompt", `Scene ${i + 1} needs a video prompt.`);
      if (requestDuration(model, s.durationS) < s.durationS - 0.05) add("fail", "duration", `Scene ${i + 1} is longer than ${model.label} can generate (${model.durations.max}s).`);
    }
    if (s.sceneType === "ai_reference" && !model.endpoints.ref) add("fail", "scene_type", `Scene ${i + 1}: ${model.label} can't use reference images — rebuild the storyboard or pick Seedance, MiniMax or Gemini.`);
    if (s.sceneType === "ai_from_product" && !model.endpoints.i2v) add("fail", "scene_type", `Scene ${i + 1}: ${model.label} can't start from a photo.`);
  });
  // Voiceover timing (plan §8, V2): warn when a segment runs past its scene or past the ad end.
  if (timeline) {
    for (const vo of getVoiceovers(versionId).filter((s) => !s.muted)) {
      const seg = timeline.segments[vo.scenePosition];
      if (!seg) {
        add("fail", "voiceover", `A voiceover is attached to scene ${vo.scenePosition + 1}, which no longer exists.`);
        continue;
      }
      const start = seg.startS + vo.offsetS;
      const end = start + (vo.durationS ?? 0);
      if (end > timeline.totalS + 0.01) add("warn", "voiceover", `Voiceover on scene ${vo.scenePosition + 1} runs ${(end - timeline.totalS).toFixed(1)}s past the end of the ad and will be cut.`);
      else if (end > seg.endS + 0.01) add("warn", "voiceover", `Voiceover on scene ${vo.scenePosition + 1} runs ${(end - seg.endS).toFixed(1)}s into the next scene.`);
      if (!vo.talentConsent) add("warn", "voiceover", `Voiceover on scene ${vo.scenePosition + 1}: no voice-artist consent recorded — export will be blocked.`);
    }
  }
  const brand = getMasterBrand();
  const outroText = brief.cta[finishing.outroLang] ?? "";
  if (finishing.outroType === "promotional" && !brief.offers.priceInr && !brief.offers.groupBuy) add("fail", "outro", "The Promotional outro needs a price or group-buy offer — add one in Price & offer, or pick another outro.");
  if (finishing.outroType === "product" && !brief.product.imageAssetIds.length) add("fail", "outro", "The Product outro needs a product photo.");
  if (!outroText) add("fail", "cta_presence", `Add the call to action in the outro language.`);
  const items = complianceItems({
    brief,
    scenes,
    outroCta: { lang: finishing.outroLang, text: outroText },
    today: indiaToday(),
    approvedCtas: brand?.tokens.approvedCtas ?? {},
    brandLines: brandLines(),
  });
  for (const it of items) if (it.status === "fail") blocking.push(it);
  else if (it.status !== "pass") warnings.push(it);
  if (settings.clipAudio && model.audio === "none") warnings.push({ check: "audio", method: "automated", status: "warn", message: `${model.label} can't generate sound; scenes will use your music only.` });
  if (model.pricing.estimate) warnings.push({ check: "cost", method: "automated", status: "warn", message: `${model.label} is billed by tokens; the estimate uses fal's approximate per-second price.` });
  const estimate = scenes.length ? estimateCost(scenes.map((s, i) => ({ ...s, position: i })), model, settings.resolution, indiaToday(), settings.clipAudio && model.audio === "toggle") : null;
  return { ok: blocking.length === 0, blocking, warnings, timeline, estimate };
}
