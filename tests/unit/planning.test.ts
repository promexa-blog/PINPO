import { describe, it, expect } from "vitest";
import { BriefInput } from "@/lib/brief";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { MODELS, buildValidatedInput, requestDuration, type NormalizedInput } from "@/server/models/registry";
import { pricePerSecond } from "@/server/models/pricing";
import { computeTimeline, sceneBudget } from "@/server/planning/timeline";
import { buildStoryboard, NO_TEXT_SUFFIX, type ClaimRecord } from "@/server/planning/storyboard";
import { loadBundledTemplates } from "@/server/planning/templates";
import { estimateCost } from "@/server/planning/estimate";
import type { Pacing } from "@/server/planning/creative";

const TEMPLATES = loadBundledTemplates();
const template = TEMPLATES.find((t) => t.key === "product_showcase")!;
const BRAND_LINES = { tagline: "Where demands connects.", groupBuyLine: "Buy it now, or buy together for less" };
const IMG = "ast_0123456789abcdef0123";

export function makeBrief(over: Partial<BriefInput> = {}): BriefInput {
  return BriefInput.parse({
    product: { name: "Steel Lunch Box", category: "home_kitchen", appearance: "a brushed stainless-steel three-tier lunch box with a matte black clip handle", imageAssetIds: [IMG] },
    audience: { who: "a young office worker in Kochi" },
    campaign: { objective: "sales", platform: "instagram_reels" },
    claims: [],
    offers: { priceInr: 899, mrpInr: 1299, confirmedOn: "2026-11-06", groupBuy: { groupPriceInr: 799, minBuyers: 5, deadline: "2026-11-30" } },
    cta: { en: "Shop now on demandmesh.shop" },
    creative: { direction: "", tone: "friendly", style: "lifestyle" },
    languages: ["en"],
    ...over,
  });
}

const claim = (position: number, text: string, extra: Partial<ClaimRecord> = {}): ClaimRecord => ({
  id: `clm_${String(position).padStart(20, "0")}`,
  position,
  language: "en",
  text,
  confirmed: true,
  attested: false,
  testimonialConsent: false,
  ...extra,
});
const CLAIMS = [claim(0, "Three separate tiers keep food apart"), claim(1, "Clip handle carries easily"), claim(2, "Easy to wash by hand"), claim(3, "Fits a standard office bag")];

describe("model registry (U1)", () => {
  const base: NormalizedInput = { mode: "t2v", prompt: "A lunch box on a desk", durationS: 4.2, resolution: "720p", aspect: "9:16", audio: false, seed: 42 };
  it("builds exact Wan 3.0 inputs", () => {
    expect(buildValidatedInput(MODELS["wan-3.0"], base)).toMatchInlineSnapshot(`
      {
        "aspect_ratio": "9:16",
        "audio": false,
        "duration": 5,
        "enable_prompt_expansion": false,
        "enable_safety_checker": true,
        "prompt": "A lunch box on a desk",
        "resolution": "720p",
        "seed": 42,
      }
    `);
    const i2v = buildValidatedInput(MODELS["wan-3.0"], { ...base, mode: "i2v", startImageUrl: "https://v3b.fal.media/files/x.png" });
    expect(i2v.start_image_url).toBe("https://v3b.fal.media/files/x.png");
  });
  it("builds exact MiniMax H3 inputs (uppercase resolution, no aspect for i2v)", () => {
    expect(buildValidatedInput(MODELS["minimax-h3-max-turbo"], base)).toMatchInlineSnapshot(`
      {
        "aspect_ratio": "9:16",
        "duration": 4.2,
        "enable_safety_checker": true,
        "prompt": "A lunch box on a desk",
        "prompt_expansion_mode": "disabled",
        "resolution": "768P",
        "seed": 42,
      }
    `);
    const i2v = buildValidatedInput(MODELS["minimax-h3-max-turbo"], { ...base, mode: "i2v", startImageUrl: "https://v3b.fal.media/files/x.png" });
    expect(i2v).not.toHaveProperty("aspect_ratio");
    expect(i2v.image_url).toBe("https://v3b.fal.media/files/x.png");
  });
  it("rejects missing start images and out-of-range durations", () => {
    expect(() => buildValidatedInput(MODELS["wan-3.0"], { ...base, mode: "i2v" })).toThrow(/start image/);
    expect(requestDuration(MODELS["wan-3.0"], 1)).toBe(2);
    expect(requestDuration(MODELS["wan-3.0"], 45)).toBe(30);
    expect(requestDuration(MODELS["minimax-h3-max-turbo"], 0.5)).toBe(0.92);
  });
  it("uses date-ranged prices (MiniMax promotion ends 2026-11-15)", () => {
    expect(pricePerSecond(MODELS["minimax-h3-max-turbo"], "720p", "2026-11-10")).toBe(0.028);
    expect(pricePerSecond(MODELS["minimax-h3-max-turbo"], "720p", "2026-11-16")).toBe(0.04);
    expect(pricePerSecond(MODELS["wan-3.0"], "1080p", "2027-01-01")).toBe(0.2);
  });
});

describe("expanded registry (U1)", () => {
  const base: NormalizedInput = { mode: "t2v", prompt: "A lunch box on a desk", durationS: 4.2, resolution: "720p", aspect: "9:16", audio: true, seed: 42 };
  const ref = ["https://v3b.fal.media/files/a.png", "https://v3b.fal.media/files/b.png"];
  it("Kling v3 Pro: string durations, negative prompt, no seed/resolution", () => {
    const i = buildValidatedInput(MODELS["kling-v3-pro"], base);
    expect(i).toMatchObject({ duration: "5", generate_audio: true, aspect_ratio: "9:16" });
    expect(i).not.toHaveProperty("seed");
    expect(i).not.toHaveProperty("resolution");
  });
  it("Seedance 2.0 Mini: reference images + string duration ≥ 4", () => {
    const i = buildValidatedInput(MODELS["seedance-2.0-mini"], { ...base, mode: "ref", durationS: 2, referenceImageUrls: ref });
    expect(i).toMatchObject({ duration: "4", image_urls: ref, resolution: "720p" });
  });
  it("Gemini Omni Flash v1.1: 3–10s, 16:9/9:16 only", () => {
    expect(buildValidatedInput(MODELS["gemini-omni-flash-1.1"], { ...base, durationS: 14 })).toMatchObject({ duration: 10 });
    expect(() => buildValidatedInput(MODELS["gemini-omni-flash-1.1"], { ...base, aspect: "1:1" })).toThrow(/16:9 and 9:16/);
  });
  it("MiniMax H3 reference mode has its own (higher) price table", () => {
    expect(pricePerSecond(MODELS["minimax-h3-max-turbo"], "720p", "2026-11-20", "ref")).toBe(0.08);
    expect(pricePerSecond(MODELS["kling-v3-pro"], "720p", "2026-11-20", "t2v", true)).toBeCloseTo(0.168, 6);
  });
});

describe("timeline (U2 property test)", () => {
  it("total always equals target for random scene sets", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 8);
      const target = [15, 30, 45, 60][Math.floor(rnd() * 4)]!;
      const outro = 2.5 + rnd() * 1.5;
      const ts = Array.from({ length: n }, (_, i) => (i === n - 1 ? 0.5 : [0, 0.25, 0.4, 0.6][Math.floor(rnd() * 4)]!));
      const budget = sceneBudget(target, outro, ts);
      const weights = Array.from({ length: n }, () => 0.5 + rnd());
      const W = weights.reduce((a, b) => a + b, 0);
      const durs = weights.map((w) => Math.round((w / W) * budget * 30) / 30);
      durs[n - 1] = Math.round((budget - durs.slice(0, -1).reduce((a, b) => a + b, 0)) * 30) / 30;
      if (durs.some((d) => d < 2.1)) continue;
      const tl = computeTimeline({ scenes: durs.map((d, i) => ({ durationS: d, transitionOutS: ts[i]! })), outroS: Math.round(outro * 30) / 30 });
      expect(Math.abs(tl.totalS - target)).toBeLessThanOrEqual(0.1);
    }
  });
  it("rejects transitions longer than a third of the shorter neighbour", () => {
    expect(() => computeTimeline({ scenes: [{ durationS: 1, transitionOutS: 0.5 }], outroS: 3 })).toThrow(/too long/);
  });
});

describe("storyboard (S1–S4, F1, F2, U3)", () => {
  const platforms = Object.keys(PLATFORMS) as PlatformKey[];
  it("hits every length for every template × platform × model, using only allowed durations (S1/U3)", () => {
    for (const tpl of TEMPLATES)
    for (const model of Object.values(MODELS)) {
      for (const platform of platforms) {
        for (const lengthS of PLATFORMS[platform].lengths) {
          for (const pacing of ["calm", "standard", "fast"] as Pacing[]) {
            const sb = buildStoryboard({ template: tpl, brief: makeBrief(), claims: CLAIMS, platform, lengthS, pacing, model, brandLines: BRAND_LINES });
            expect(Math.abs(sb.timeline.totalS - lengthS)).toBeLessThanOrEqual(0.1);
            for (const s of sb.scenes) {
              expect(s.durationS).toBeGreaterThanOrEqual(2);
              if (s.sceneType !== "product_original") expect(requestDuration(model, s.durationS)).toBeLessThanOrEqual(model.durations.max);
            }
            expect(sb.blocked, `${tpl.key}/${model.id}/${platform}/${lengthS}/${pacing}: ${sb.placeholders.map((x) => x.message).join("; ")}`).toBe(false);
            if (model.references) expect(sb.scenes.some((x) => x.sceneType === "ai_from_product")).toBe(false);
          }
        }
      }
    }
  });

  it("uses whole-second AI durations for integer-only models so nothing is wasted", () => {
    const sb = buildStoryboard({ template, brief: makeBrief(), claims: CLAIMS, platform: "instagram_reels", lengthS: 30, pacing: "standard", model: MODELS["wan-3.0"] });
    for (const s of sb.scenes.filter((x) => x.sceneType !== "product_original")) expect(Number.isInteger(s.durationS)).toBe(true);
  });

  it("blocks generation with placeholders when confirmed benefits are missing (S2)", () => {
    const sb = buildStoryboard({ template, brief: makeBrief(), claims: [claim(0, "Keeps food apart", { confirmed: false })], platform: "instagram_reels", lengthS: 15, pacing: "standard", model: MODELS["wan-3.0"] });
    expect(sb.blocked).toBe(true);
    expect(sb.placeholders.map((p) => p.message)).toContain("[Add confirmed benefit 1]");
  });

  it("copies overlay text verbatim from the brief, computes the offer, and never invents claims (S4)", () => {
    const sb = buildStoryboard({ template, brief: makeBrief(), claims: CLAIMS, platform: "instagram_reels", lengthS: 15, pacing: "standard", model: MODELS["wan-3.0"] });
    const texts = sb.scenes.flatMap((s) => s.overlay.byLang.en ?? []).map((l) => l.text);
    expect(texts).toContain("Steel Lunch Box");
    expect(texts).toContain("Three separate tiers keep food apart");
    expect(texts).toContain("₹899");
    expect(texts).toContain("₹1,299");
    expect(texts).toContain("30% off"); // floor((1299-899)/1299·100) = 30
    expect(texts).toContain("Shop now on demandmesh.shop");
    for (const s of sb.scenes.filter((x) => x.prompt)) {
      expect(s.prompt).toContain(NO_TEXT_SUFFIX);
      expect(s.prompt).not.toMatch(/Steel Lunch Box|₹|% off|best|#1/);
    }
    const productScene = sb.scenes.find((s) => s.sceneType === "ai_from_product")!;
    expect(productScene.prompt).toContain("brushed stainless-steel three-tier lunch box");
  });

  it("drops failing claims (e.g. unsubstantiated medical) from overlays (M1 via storyboard)", () => {
    const claims = [claim(0, "Cures acne in 7 days"), ...CLAIMS.slice(0, 2).map((c, i) => ({ ...c, position: i + 1 }))];
    const sb = buildStoryboard({ template, brief: makeBrief(), claims, platform: "instagram_reels", lengthS: 15, pacing: "standard", model: MODELS["wan-3.0"] });
    const texts = sb.scenes.flatMap((s) => s.overlay.byLang.en ?? []).map((l) => l.text);
    expect(texts).not.toContain("Cures acne in 7 days");
  });

  it("varies footage controls by product while the brand layer stays fixed (F1)", () => {
    const a = buildStoryboard({ template, brief: makeBrief(), claims: CLAIMS, platform: "instagram_reels", lengthS: 30, pacing: "standard", model: MODELS["wan-3.0"] });
    const b = buildStoryboard({
      template,
      brief: makeBrief({ product: { name: "Silk Scarf", category: "fashion_accessories", appearance: "a hand-woven red silk scarf with a gold border", imageAssetIds: [IMG] }, creative: { direction: "", tone: "premium", style: "bold" } }),
      claims: CLAIMS,
      platform: "instagram_reels",
      lengthS: 30,
      pacing: "standard",
      model: MODELS["wan-3.0"],
    });
    const sig = (sb: typeof a) => sb.scenes.map((s) => `${s.creative.camera}|${s.creative.lighting}|${s.creative.setting}`).join(";");
    expect(sig(a)).not.toBe(sig(b));
    expect(a.outroS).toBe(b.outroS);
    expect(a.scenes.map((s) => s.overlay.motion)).toEqual(b.scenes.map((s) => s.overlay.motion));
  });

  it("re-weights durations with pacing without changing the total (F2)", () => {
    const calm = buildStoryboard({ template, brief: makeBrief(), claims: CLAIMS, platform: "instagram_reels", lengthS: 30, pacing: "calm", model: MODELS["minimax-h3-max-turbo"] });
    const fast = buildStoryboard({ template, brief: makeBrief(), claims: CLAIMS, platform: "instagram_reels", lengthS: 30, pacing: "fast", model: MODELS["minimax-h3-max-turbo"] });
    expect(calm.scenes[0]!.durationS).toBeGreaterThan(fast.scenes[0]!.durationS);
    expect(Math.abs(calm.timeline.totalS - 30)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(fast.timeline.totalS - 30)).toBeLessThanOrEqual(0.1);
  });

  it("estimates only AI scenes at list price (labelled Estimated)", () => {
    const sb = buildStoryboard({ template, brief: makeBrief(), claims: CLAIMS, platform: "instagram_reels", lengthS: 15, pacing: "standard", model: MODELS["wan-3.0"] });
    const est = estimateCost(sb.scenes, MODELS["wan-3.0"], "720p", "2026-11-06");
    const ai = sb.scenes.filter((s) => s.sceneType !== "product_original");
    expect(est.totalUsd).toBeCloseTo(ai.reduce((a, s) => a + Math.ceil(s.durationS) * 0.1, 0), 4);
    expect(est.label).toBe("Estimated");
  });
});
