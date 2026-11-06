import "../../guard";
import { z } from "zod";
import { promptSchema as prompt, urlSchema as url, requestDuration, type ModelSpec } from "../types";

/** Wan 3.0 — verified 2026-11-06 (OpenAPI + llms.txt + catalog). */
const common = {
  prompt,
  duration: z.number().int().min(2).max(30),
  resolution: z.enum(["480p", "720p", "1080p"]),
  aspect_ratio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  audio: z.boolean(),
  enable_prompt_expansion: z.boolean(),
  enable_safety_checker: z.boolean(),
  seed: z.number().int().optional(),
};

export const wan3: ModelSpec = {
  id: "wan-3.0",
  label: "Wan 3.0",
  summary: "Default all-rounder. 2–30s clips, 480p–1080p, optional native audio, start and end frames.",
  endpoints: { t2v: "alibaba/wan-3.0/text-to-video", i2v: "alibaba/wan-3.0/image-to-video" },
  durations: { kind: "int-range", min: 2, max: 30 },
  resolutions: ["480p", "720p", "1080p"],
  aspects: ["9:16", "16:9", "1:1"],
  i2vAspectFollowsImage: false,
  audio: "toggle",
  frames: { start: true, end: true },
  references: null,
  seed: true,
  license: { type: "commercial", verifiedAt: "2026-11-06" },
  pricing: { verifiedAt: "2026-11-06", currency: "USD", periods: [{ perSecond: { "480p": 0.05, "720p": 0.1, "1080p": 0.2 } }] },
  verifiedAt: "2026-11-06",
  retiresAt: null,
  buildInput(n) {
    const base: Record<string, unknown> = {
      prompt: n.prompt,
      duration: requestDuration(this, n.durationS),
      resolution: n.resolution,
      aspect_ratio: n.aspect,
      audio: n.audio,
      enable_prompt_expansion: n.promptExpansion ?? false,
      enable_safety_checker: true,
    };
    if (n.seed !== undefined) base.seed = n.seed;
    if (n.mode === "i2v") {
      if (!n.startImageUrl) throw new Error("Wan image-to-video needs a start image");
      base.start_image_url = n.startImageUrl;
      if (n.endImageUrl) base.end_image_url = n.endImageUrl;
    }
    return base;
  },
  inputSchema: {
    t2v: z.object(common).strict(),
    i2v: z.object({ ...common, start_image_url: url, end_image_url: url.optional() }).strict(),
  },
};
