/** Client-safe colour helpers shared by the brand form (live preview) and the server (validation). */

export const HEX = /^#[0-9A-Fa-f]{6}$/;

function rgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Linear mix: `amount` of `b` into `a` (sRGB, good enough for UI tints). */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * amount) as [number, number, number]);
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2 contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

/** Darkens a colour step by step until it reaches `target` contrast on white (for "use a darker shade"). */
export function darkenToContrast(hex: string, target: number): string {
  let c = hex.toUpperCase();
  for (let i = 0; i < 40 && contrastRatio(c, "#FFFFFF") < target; i++) c = mix(c, "#000000", 0.06);
  return c;
}

/** Brand-layer roles: overlay panels put white text on `primary` and `primary` text on white. */
export const BRAND_CONTRAST = { primaryOnWhite: 4.5, secondaryOnWhite: 3 } as const;

/**
 * Full token palette from the two colours a person picks. Everything else is derived so overlays,
 * CTAs and outros stay readable for any brand.
 */
export function derivePalette(primary: string, secondary: string): Record<string, string> {
  const p = primary.toUpperCase();
  const s = secondary.toUpperCase();
  return {
    primary: p,
    primaryHover: mix(p, "#FFFFFF", 0.1),
    secondary: s,
    secondaryLight: mix(s, "#FFFFFF", 0.88),
    background: "#FFFFFF",
    surface: mix(s, "#FFFFFF", 0.96),
    border: mix(s, "#FFFFFF", 0.82),
    white: "#FFFFFF",
    black: "#000000",
  };
}

export function paletteProblems(primary: string, secondary: string): string[] {
  const out: string[] = [];
  if (!HEX.test(primary)) out.push("Main colour must be a hex value like #0C1C28.");
  if (!HEX.test(secondary)) out.push("Accent colour must be a hex value like #526979.");
  if (out.length) return out;
  const cp = contrastRatio(primary, "#FFFFFF");
  if (cp < BRAND_CONTRAST.primaryOnWhite)
    out.push(`Main colour is too light for text (${cp.toFixed(1)}:1 on white, needs ${BRAND_CONTRAST.primaryOnWhite}:1). Try ${darkenToContrast(primary, BRAND_CONTRAST.primaryOnWhite)}.`);
  const cs = contrastRatio(secondary, "#FFFFFF");
  if (cs < BRAND_CONTRAST.secondaryOnWhite)
    out.push(`Accent colour is too light for taglines (${cs.toFixed(1)}:1 on white, needs ${BRAND_CONTRAST.secondaryOnWhite}:1). Try ${darkenToContrast(secondary, BRAND_CONTRAST.secondaryOnWhite)}.`);
  return out;
}

/** Website as shown on the outro: bare host + optional path, no scheme. */
export function normalizeWebsite(input: string): string {
  return input.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}
export const WEBSITE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[\w\-./]*)?$/i;
