import { z } from "zod";
import { BriefInput, ClaimInput, Lang } from "./brief";

/** Version-level settings + editable scene shape, shared by editor and API (client-safe). */

export const ModelIdSchema = z.enum(["wan-3.0", "minimax-h3-max-turbo", "kling-v3-pro", "seedance-2.0-mini", "gemini-omni-flash-1.1"]);
export const ResolutionSchema = z.enum(["480p", "720p", "1080p"]);
export const PacingSchema = z.enum(["calm", "standard", "fast"]);
export const AudioModeSchema = z.enum(["music_only", "clip_only", "mix"]);

export const VersionSettings = z.object({
  templateKey: z.string().regex(/^[a-z_]+$/),
  modelId: ModelIdSchema,
  resolution: ResolutionSchema,
  lengthS: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]),
  /** Native clip audio from the model, where it supports a toggle. */
  clipAudio: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647),
});
export type VersionSettings = z.infer<typeof VersionSettings>;

export const Finishing = z.object({
  outroType: z.enum(["standard", "promotional", "product", "minimal"]),
  outroLang: Lang,
  audioMode: AudioModeSchema,
  musicAssetId: z.string().regex(/^ast_[a-f0-9]{20}$/).nullable(),
  musicVolumeDb: z.number().min(-30).max(6),
  /** Lower scene sound under the voiceover too (music always ducks under voiceover). */
  duckClipUnderVoice: z.boolean().default(true),
});
export type Finishing = z.infer<typeof Finishing>;

const OverlayLineSchema = z.object({
  kind: z.enum(["product_name", "claim", "offer_price", "offer_mrp", "offer_discount", "offer_validity", "group_price", "group_min", "group_deadline", "tagline", "brand_line", "cta", "placeholder"]),
  text: z.string().max(200),
  claimId: z.string().optional(),
});

export const SceneEdit = z.object({
  id: z.string().regex(/^scn_[a-f0-9]{20}$/).optional(),
  role: z.string().max(40),
  label: z.string().max(80),
  sceneType: z.enum(["product_original", "ai_from_product", "ai_reference", "ai_scene"]),
  showsProduct: z.boolean(),
  durationS: z.number().min(1).max(30),
  visualDirection: z.string().max(400),
  prompt: z.string().max(2000),
  motionPreset: z.enum(["fade-up", "slide-in", "scale-in", "logo-reveal"]),
  creative: z.object({
    camera: z.enum(["static", "slow push-in", "pull-out", "orbit", "pan", "top-down", "handheld", "macro"]),
    lighting: z.enum(["soft studio", "natural daylight", "golden hour", "moody low-key", "high-key bright"]),
    setting: z.string().max(200),
    transitionOut: z.enum(["cut", "crossfade", "dip_white", "dip_primary", "slide"]),
    layoutVariant: z.enum(["lower_third", "centered", "side_panel", "corner_badge", "split_headline"]),
    productMotion: z.enum(["push-in", "pan", "parallax", "rotate-in"]),
  }),
  overlay: z.object({
    layout: z.enum(["lower_third", "centered", "side_panel", "corner_badge", "split_headline"]),
    motion: z.enum(["fade-up", "slide-in", "scale-in", "logo-reveal"]),
    byLang: z.record(Lang, z.array(OverlayLineSchema).max(8)),
  }),
  productAssetId: z.string().regex(/^ast_[a-f0-9]{20}$/).nullable(),
});
export type SceneEdit = z.infer<typeof SceneEdit>;

export const VoiceoverSegment = z.object({
  assetId: z.string().regex(/^ast_[a-f0-9]{20}$/),
  scenePosition: z.number().int().min(0).max(11),
  offsetS: z.number().min(0).max(30),
  volumeDb: z.number().min(-20).max(10),
  fadeInS: z.number().min(0).max(3),
  fadeOutS: z.number().min(0).max(3),
  muted: z.boolean().default(false),
});
export type VoiceoverSegment = z.infer<typeof VoiceoverSegment>;

export const VersionPatch = z.object({
  revision: z.number().int().min(0),
  name: z.string().trim().min(1).max(120).optional(),
  brief: BriefInput.optional(),
  claims: z.array(ClaimInput).max(36).optional(),
  settings: VersionSettings.optional(),
  finishing: Finishing.optional(),
  platform: z.enum(["instagram_reels", "instagram_story", "youtube_shorts", "instagram_feed", "facebook_feed", "youtube_instream"]).optional(),
  pacing: PacingSchema.optional(),
  scenes: z.array(SceneEdit).max(12).optional(),
  voiceovers: z.array(VoiceoverSegment).max(12).optional(),
});
export type VersionPatch = z.infer<typeof VersionPatch>;
