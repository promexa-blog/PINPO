/** Client-safe platform presets: format, export size, allowed lengths and text-safe areas (plan §6, §9). */

export type Aspect = "9:16" | "16:9" | "1:1";
export type PlatformKey = "instagram_reels" | "instagram_story" | "youtube_shorts" | "instagram_feed" | "facebook_feed" | "youtube_instream";

export interface SafeArea {
  /** Fractions of the frame kept clear of text/logos (platform UI overlays). */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PlatformSpec {
  key: PlatformKey;
  label: string;
  aspect: Aspect;
  width: number;
  height: number;
  lengths: number[];
  safe: SafeArea;
}

const VERTICAL_SAFE: SafeArea = { top: 0.14, bottom: 0.22, left: 0.06, right: 0.06 };

export const PLATFORMS: Record<PlatformKey, PlatformSpec> = {
  instagram_reels: { key: "instagram_reels", label: "Instagram Reels", aspect: "9:16", width: 1080, height: 1920, lengths: [15, 30, 45, 60], safe: VERTICAL_SAFE },
  instagram_story: { key: "instagram_story", label: "Instagram Story", aspect: "9:16", width: 1080, height: 1920, lengths: [15], safe: VERTICAL_SAFE },
  youtube_shorts: { key: "youtube_shorts", label: "YouTube Shorts", aspect: "9:16", width: 1080, height: 1920, lengths: [15, 30, 45, 60], safe: VERTICAL_SAFE },
  instagram_feed: { key: "instagram_feed", label: "Instagram Feed", aspect: "1:1", width: 1080, height: 1080, lengths: [15, 30, 45, 60], safe: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 } },
  facebook_feed: { key: "facebook_feed", label: "Facebook Feed", aspect: "1:1", width: 1080, height: 1080, lengths: [15, 30, 45, 60], safe: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 } },
  youtube_instream: { key: "youtube_instream", label: "YouTube in-stream", aspect: "16:9", width: 1920, height: 1080, lengths: [15, 30, 45, 60], safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
};

export const FPS = 30;

/** Rounds seconds to whole frames so every duration is representable exactly. */
export const toFrames = (s: number): number => Math.round(s * FPS);
export const frameSeconds = (s: number): number => toFrames(s) / FPS;
