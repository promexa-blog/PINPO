import "../../guard";
import { z } from "zod";
import { promptSchema as prompt, urlSchema as url, requestDuration, NEGATIVE_PROMPT, type ModelSpec } from "../types";

/**
 * Kling v3 Pro — verified 2026-11-06. No resolution parameter (Kling chooses); image-to-video
 * follows the start image's aspect; no seed. Product "elements" exist but aren't used in v1.
 */
const DUR = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"] as const;
const base = {
  prompt,
  duration: z.enum(DUR),
  generate_audio: z.boolean(),
  negative_prompt: z.string(),
  enable_safety_checker: z.boolean(),
};

export const klingV3: ModelSpec = {
  id: "kling-v3-pro",
  label: "Kling v3 Pro",
  summary: "High quality. 3–15s, start and end frames, optional native audio. Kling chooses the output resolution.",
  endpoints: { t2v: "fal-ai/kling-video/v3/pro/text-to-video", i2v: "fal-ai/kling-video/v3/pro/image-to-video" },
  durations: { kind: "int-range", min: 3, max: 15 },
  // No resolution parameter: one quality tier, validated as ≥720p on delivery.
  resolutions: ["720p"],
  aspects: ["9:16", "16:9", "1:1"],
  i2vAspectFollowsImage: true,
  audio: "toggle",
  frames: { start: true, end: true },
  references: null,
  seed: false,
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: { verifiedAt: "2026-11-06", currency: "USD", periods: [{ perSecond: { "720p": 0.112 }, audioPerSecond: { "720p": 0.056 } }] },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    const out: Record<string, unknown> = {
      prompt: n.prompt,
      duration: String(requestDuration(this, n.durationS)),
      generate_audio: n.audio,
      negative_prompt: NEGATIVE_PROMPT,
      enable_safety_checker: true,
    };
    if (n.mode === "t2v") out.aspect_ratio = n.aspect;
    else {
      if (!n.startImageUrl) throw new Error("Kling image-to-video needs a start image");
      out.start_image_url = n.startImageUrl;
      if (n.endImageUrl) out.end_image_url = n.endImageUrl;
    }
    return out;
  },
  inputSchema: {
    t2v: z.object({ ...base, aspect_ratio: z.enum(["16:9", "9:16", "1:1"]) }).strict(),
    i2v: z.object({ ...base, start_image_url: url, end_image_url: url.optional() }).strict(),
  },
};
