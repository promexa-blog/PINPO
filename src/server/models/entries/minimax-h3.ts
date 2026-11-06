import "../../guard";
import { z } from "zod";
import { promptSchema as prompt, urlSchema as url, requestDuration, type ModelSpec, type Resolution } from "../types";

/** MiniMax H3 Max Turbo — verified 2026-11-06. Reference mode is priced higher than text/image mode. */
const RES: Record<Resolution, string> = { "480p": "480P", "720p": "768P", "1080p": "1080P" };
const base = {
  prompt,
  prompt_expansion_mode: z.enum(["disabled", "fast", "balanced", "quality"]),
  duration: z.number().min(0.92).max(15),
  resolution: z.enum(["480P", "768P", "1080P"]),
  enable_safety_checker: z.boolean(),
  seed: z.number().int().optional(),
};

export const minimaxH3: ModelSpec = {
  id: "minimax-h3-max-turbo",
  label: "MiniMax H3 Max Turbo",
  summary: "Cheapest. Up to 15s, 480P/768P/1080P, start and end frames, up to 9 product reference images. No audio control (studio adds sound).",
  endpoints: { t2v: "minimax/h3-max-turbo/text-to-video", i2v: "minimax/h3-max-turbo/image-to-video", ref: "minimax/h3-max-turbo/reference-to-video" },
  durations: { kind: "number-range", min: 0.92, max: 15 },
  resolutions: ["480p", "720p", "1080p"],
  aspects: ["9:16", "16:9", "1:1"],
  i2vAspectFollowsImage: true,
  audio: "none",
  frames: { start: true, end: true },
  references: { max: 9, promptTag: (i) => `Image ${i}` },
  seed: true,
  notes: "Reference mode adds $0.016 per 1K reference tokens beyond the first 4,096 (not included in estimates).",
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: {
    verifiedAt: "2026-11-06",
    currency: "USD",
    periods: [
      // fal promotion "30% off standard rates" 2026-11-01 → 2026-11-15; 768P is our "720p" tier.
      { from: "2026-11-01", until: "2026-11-15", perSecond: { "480p": 0.0175, "720p": 0.028, "1080p": 0.056 } },
      { from: "2026-11-16", perSecond: { "480p": 0.025, "720p": 0.04, "1080p": 0.08 } },
    ],
    modes: { ref: [{ perSecond: { "480p": 0.05, "720p": 0.08, "1080p": 0.16 } }] },
  },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    const out: Record<string, unknown> = {
      prompt: n.prompt,
      prompt_expansion_mode: n.promptExpansion ? "balanced" : "disabled",
      duration: requestDuration(this, n.durationS),
      resolution: RES[n.resolution],
      enable_safety_checker: true,
    };
    if (n.seed !== undefined) out.seed = n.seed;
    if (n.mode === "t2v") out.aspect_ratio = n.aspect;
    else if (n.mode === "i2v") {
      if (!n.startImageUrl) throw new Error("MiniMax image-to-video needs a start image");
      out.image_url = n.startImageUrl;
      if (n.endImageUrl) out.end_image_url = n.endImageUrl;
    } else {
      if (!n.referenceImageUrls?.length) throw new Error("MiniMax reference-to-video needs reference images");
      out.reference_image_urls = n.referenceImageUrls.slice(0, 9);
      out.aspect_ratio = n.aspect;
    }
    return out;
  },
  inputSchema: {
    t2v: z.object({ ...base, aspect_ratio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]) }).strict(),
    i2v: z.object({ ...base, image_url: url, end_image_url: url.optional() }).strict(),
    ref: z.object({ ...base, aspect_ratio: z.enum(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), reference_image_urls: z.array(url).min(1).max(9) }).strict(),
  },
};
