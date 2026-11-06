import "../../guard";
import { z } from "zod";
import { promptSchema as prompt, urlSchema as url, requestDuration, type ModelSpec } from "../types";

/**
 * Gemini Omni Flash v1.1 — verified 2026-11-06. Native audio always included; 16:9 and 9:16
 * only; 3–10s (v1.1 limit — fal research quoted v1.2's 15s); no seed. 4k exists but isn't offered.
 */
const base = {
  prompt,
  resolution: z.enum(["360p", "720p", "1080p", "4k"]),
  aspect_ratio: z.enum(["16:9", "9:16"]),
  duration: z.number().int().min(3).max(10),
};

export const geminiOmni: ModelSpec = {
  id: "gemini-omni-flash-1.1",
  label: "Gemini Omni Flash v1.1",
  summary: "Google model with native sound. 3–10s, 720p/1080p, 16:9 and 9:16 only, start and end frames, up to 10 reference images.",
  endpoints: { t2v: "google/gemini-omni-flash/v1.1/text-to-video", i2v: "google/gemini-omni-flash/v1.1/image-to-video", ref: "google/gemini-omni-flash/v1.1/reference-to-video" },
  durations: { kind: "int-range", min: 3, max: 10 },
  resolutions: ["720p", "1080p"],
  aspects: ["9:16", "16:9"],
  i2vAspectFollowsImage: false,
  audio: "always",
  frames: { start: true, end: true },
  references: { max: 10, promptTag: (i) => `reference image ${i}` },
  seed: false,
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: { verifiedAt: "2026-11-06", currency: "USD", periods: [{ perSecond: { "720p": 0.1, "1080p": 0.15 } }] },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    if (n.aspect === "1:1") throw new Error("Gemini Omni Flash supports only 16:9 and 9:16");
    const out: Record<string, unknown> = { prompt: n.prompt, resolution: n.resolution, aspect_ratio: n.aspect, duration: requestDuration(this, n.durationS) };
    if (n.mode === "i2v") {
      if (!n.startImageUrl) throw new Error("Gemini image-to-video needs a start image");
      out.image_url = n.startImageUrl;
      if (n.endImageUrl) out.end_image_url = n.endImageUrl;
    } else if (n.mode === "ref") {
      if (!n.referenceImageUrls?.length) throw new Error("Gemini reference-to-video needs reference images");
      out.image_urls = n.referenceImageUrls.slice(0, 10);
    }
    return out;
  },
  inputSchema: {
    t2v: z.object(base).strict(),
    i2v: z.object({ ...base, image_url: url, end_image_url: url.optional() }).strict(),
    ref: z.object({ ...base, image_urls: z.array(url).min(1).max(10) }).strict(),
  },
};
