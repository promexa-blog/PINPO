import "../../guard";
import { z } from "zod";
import { promptSchema as prompt, urlSchema as url, requestDuration, type ModelSpec } from "../types";

/**
 * Seedance 2.0 Mini — verified 2026-11-06. Token-billed; fal's quoted per-second figures are used
 * as estimates. Up to 9 product reference images, referred to in prompts as @Image1…
 */
const DUR = ["auto", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"] as const;
const base = {
  prompt,
  duration: z.enum(DUR),
  resolution: z.enum(["480p", "720p"]),
  aspect_ratio: z.enum(["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  generate_audio: z.boolean(),
};

export const seedance2Mini: ModelSpec = {
  id: "seedance-2.0-mini",
  label: "Seedance 2.0 Mini",
  summary: "Product consistency. 4–15s, 480p/720p, start and end frames, up to 9 product reference images, optional audio.",
  endpoints: { t2v: "bytedance/seedance-2.0/mini/text-to-video", i2v: "bytedance/seedance-2.0/mini/image-to-video", ref: "bytedance/seedance-2.0/mini/reference-to-video" },
  durations: { kind: "int-range", min: 4, max: 15 },
  resolutions: ["480p", "720p"],
  aspects: ["9:16", "16:9", "1:1"],
  i2vAspectFollowsImage: false,
  audio: "toggle",
  frames: { start: true, end: true },
  references: { max: 9, promptTag: (i) => `@Image${i}` },
  seed: false,
  notes: "Billed by video tokens (H×W×seconds×24/1024 at $0.007 per 1K); per-second prices are fal's quoted approximations.",
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: { verifiedAt: "2026-11-06", currency: "USD", estimate: true, periods: [{ perSecond: { "480p": 0.0721, "720p": 0.1547 } }] },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    const out: Record<string, unknown> = {
      prompt: n.prompt,
      duration: String(requestDuration(this, n.durationS)),
      resolution: n.resolution,
      aspect_ratio: n.aspect,
      generate_audio: n.audio,
    };
    if (n.mode === "i2v") {
      if (!n.startImageUrl) throw new Error("Seedance image-to-video needs a start image");
      out.image_url = n.startImageUrl;
      if (n.endImageUrl) out.end_image_url = n.endImageUrl;
    } else if (n.mode === "ref") {
      if (!n.referenceImageUrls?.length) throw new Error("Seedance reference-to-video needs reference images");
      out.image_urls = n.referenceImageUrls.slice(0, 9);
    }
    return out;
  },
  inputSchema: {
    t2v: z.object(base).strict(),
    i2v: z.object({ ...base, image_url: url, end_image_url: url.optional() }).strict(),
    ref: z.object({ ...base, image_urls: z.array(url).min(1).max(9) }).strict(),
  },
};
