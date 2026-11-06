/** Client-safe brand layout helpers shared by the renderer and the editor preview (plan §3, §13). */

export interface BrandColors {
  primary: string;
  primaryHover: string;
  secondary: string;
  secondaryLight: string;
  background: string;
  surface: string;
  border: string;
  white: string;
  black: string;
}

export interface Frame {
  width: number;
  height: number;
  safe: { top: number; bottom: number; left: number; right: number };
}

/** Font sizes are % of frame height (brand.json typography.scale), shrunk to keep lines readable. */
export const SCALE = { headline: 5.2, subheadline: 3.0, body: 2.4, cta: 2.8, caption: 2.0 } as const;

/** 9:16 frames are tall; scale type off the shorter side so 16:9 and 9:16 read alike. */
export function px(frame: Frame, pct: number): number {
  // Landscape frames are viewed larger (TV/desktop) but have less height: scale type up 1.4×
  // there so 16:9 text isn't tiny (Phase 9 polish). Portrait/square keep the plan's scale.
  const basis = frame.width > frame.height ? frame.height * 1.4 : Math.min(frame.height, frame.width * (16 / 9));
  return Math.round((basis * pct) / 100);
}

/** Spacing unit = 0.74% of frame width (brand.json spacing.unit). */
export function unit(frame: Frame, n = 1): number {
  return Math.round(((frame.width * 0.74) / 100) * n);
}

/** Shrinks long text (no JS in render documents, so fitting is computed up front). */
export function fitSize(basePx: number, text: string, comfortableChars: number, minRatio = 0.6): number {
  const len = [...text].length;
  if (len <= comfortableChars) return basePx;
  return Math.round(basePx * Math.max(minRatio, Math.sqrt(comfortableChars / len)));
}

export function safeBox(frame: Frame) {
  const left = Math.round(frame.width * frame.safe.left);
  const right = Math.round(frame.width * frame.safe.right);
  const top = Math.round(frame.height * frame.safe.top);
  const bottom = Math.round(frame.height * frame.safe.bottom);
  return { left, right, top, bottom, width: frame.width - left - right, height: frame.height - top - bottom };
}

export const FONT_STACK: Record<"en" | "ml" | "hi", string> = {
  en: '"PINPO Sans", system-ui, sans-serif',
  ml: '"PINPO Malayalam", "PINPO Sans", sans-serif',
  hi: '"PINPO Devanagari", "PINPO Sans", sans-serif',
};
