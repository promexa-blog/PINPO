import "../guard";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import type { Lang } from "@/lib/brief";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import type { BrandColors, Frame } from "@/lib/brand-layout/tokens";
import { MinimalOutro, OverlayLayer, ProductOutro, ProductStill, PromotionalOutro, StandardOutro, wordmarkLang, type LayoutVariant, type OverlayLine } from "@/lib/brand-layout/components";
import { WEBSITE } from "@/lib/color";
import type { Brand } from "../brand/kits";
import { absolutePath, getAsset } from "../storage/assets";
import { AppError, sha256 } from "../util";
import { renderer, type FontNeed } from "./browser";

/** Renders brand-layer graphics (overlays, outro, product canvas) to PNG via the pinned Chrome. */

export function frameFor(platform: PlatformKey): Frame {
  const p = PLATFORMS[platform];
  return { width: p.width, height: p.height, safe: p.safe };
}

export function brandColors(brand: Brand): BrandColors {
  const c = brand.tokens.colors;
  return {
    primary: c.primary!,
    primaryHover: c.primaryHover!,
    secondary: c.secondary!,
    secondaryLight: c.secondaryLight!,
    background: c.background!,
    surface: c.surface!,
    border: c.border!,
    white: c.white ?? "#FFFFFF",
    black: c.black ?? "#000000",
  };
}

/** Colour rule (plan §3): every colour used by the brand layer must be a token. */
export function assertTokenColors(colors: BrandColors, brand: Brand): void {
  const allowed = new Set(Object.values(brand.tokens.colors).map((v) => v.toUpperCase()));
  for (const [k, v] of Object.entries(colors)) {
    if (!allowed.has(v.toUpperCase())) throw new AppError("BRAND_COLOR", `Colour ${k}=${v} is not one of the brand\'s colours`, 422);
  }
}

/**
 * Official logo with pinned-hash verification — the renderer refuses anything else (plan §3).
 * Null when the brand has no logo: outros then set the brand name as a text wordmark.
 */
export function officialLogo(brand: Brand) {
  const logo = brand.logos.find((l) => l.variant === "horizontal");
  if (!logo) return null;
  const asset = getAsset(logo.assetId);
  if (!asset || asset.sha256 !== logo.pinnedSha256 || !asset.official) throw new AppError("LOGO_NOT_OFFICIAL", "Logo file does not match the pinned official logo", 500);
  const spec = brand.tokens.logo?.horizontal;
  return { asset, src: pathToFileURL(absolutePath(asset)).href, width: asset.width!, height: asset.height!, maxScale: spec?.maxScale ?? 1.25 };
}

/** The outro shows the brand's website exactly as saved in its revision. */
export function outroWebsite(brand: Brand): string {
  const website = brand.tokens.website;
  if (!WEBSITE.test(website)) throw new AppError("OUTRO_WEBSITE", `The brand website "${website}" isn't a valid address — fix it on the Brands page.`, 422);
  return website;
}

type LogoProp = { src: string; width: number; height: number; maxScale: number } | null;
const logoProp = (logo: ReturnType<typeof officialLogo>): LogoProp => (logo ? { src: logo.src, width: logo.width, height: logo.height, maxScale: logo.maxScale } : null);
/** Font needs for the wordmark (only when there's no logo file). */
const wordmarkFonts = (brand: Brand, logo: ReturnType<typeof officialLogo>): FontNeed[] => (logo ? [] : [{ lang: wordmarkLang(brand.tokens.name), weight: 800, text: brand.tokens.name }]);

export interface RenderedPng {
  file: string;
  /** Hash of the inputs, used as cache key and QA evidence. */
  inputHash: string;
}

export async function renderOverlay(args: {
  brand: Brand;
  platform: PlatformKey;
  lang: Lang;
  layout: LayoutVariant;
  lines: OverlayLine[];
  outFile: string;
}): Promise<RenderedPng> {
  const frame = frameFor(args.platform);
  const colors = brandColors(args.brand);
  assertTokenColors(colors, args.brand);
  const lines = args.lines.filter((l) => l.kind !== "placeholder");
  if (lines.length !== args.lines.length) throw new AppError("PLACEHOLDER_IN_OVERLAY", "Overlay still contains placeholder text", 422);
  const bodyHtml = renderToStaticMarkup(createElement(OverlayLayer, { frame, colors, lang: args.lang, layout: args.layout, lines }));
  const fonts: FontNeed[] = lines.map((l) => ({ lang: /^(offer_|group_)/.test(l.kind) ? "en" : args.lang, weight: 700, text: l.text }));
  await renderer.render({ width: frame.width, height: frame.height, transparent: true, css: "", bodyHtml, fonts, outFile: args.outFile });
  return { file: args.outFile, inputHash: sha256(JSON.stringify({ v: 1, f: frame, l: args.layout, lang: args.lang, lines })) };
}

export async function renderStandardOutro(args: { brand: Brand; platform: PlatformKey; lang: Lang; cta: string; outFile: string }): Promise<RenderedPng> {
  const frame = frameFor(args.platform);
  const colors = brandColors(args.brand);
  const logo = officialLogo(args.brand);
  const website = outroWebsite(args.brand);
  const bodyHtml = renderToStaticMarkup(
    createElement(StandardOutro, { frame, colors, lang: args.lang, logo: logoProp(logo), brandName: args.brand.tokens.name, tagline: args.brand.tokens.tagline, cta: args.cta, website }),
  );
  await renderer.render({
    width: frame.width,
    height: frame.height,
    css: "",
    bodyHtml,
    fonts: [
      ...(args.brand.tokens.tagline ? [{ lang: "en" as const, weight: 500, text: args.brand.tokens.tagline }] : []),
      ...wordmarkFonts(args.brand, logo),
      { lang: args.lang, weight: 700, text: args.cta },
      { lang: "en", weight: 700, text: website },
    ],
    outFile: args.outFile,
  });
  return { file: args.outFile, inputHash: sha256(JSON.stringify({ v: 1, frame, cta: args.cta, logo: logo?.asset.sha256 ?? args.brand.tokens.name, website, tag: args.brand.tokens.tagline, colors })) };
}

export type OutroType = "standard" | "promotional" | "product" | "minimal";

/**
 * Renders any outro preset (plan §6). Offer/price text comes only from brief-derived
 * lines; the product image is the original upload; the logo is the pinned official file.
 */
export async function renderOutro(args: {
  brand: Brand;
  platform: PlatformKey;
  lang: Lang;
  type: OutroType;
  cta: string;
  offerLines: OverlayLine[];
  product?: { assetId: string; name: string; price: string | null };
  outFile: string;
}): Promise<RenderedPng> {
  if (args.type === "standard") return renderStandardOutro(args);
  const frame = frameFor(args.platform);
  const colors = brandColors(args.brand);
  const logo = officialLogo(args.brand);
  const website = outroWebsite(args.brand);
  const common = { frame, colors, lang: args.lang, logo: logoProp(logo), brandName: args.brand.tokens.name, tagline: args.brand.tokens.tagline, cta: args.cta, website };
  const fonts: FontNeed[] = [{ lang: "en", weight: 700, text: website }, ...wordmarkFonts(args.brand, logo)];
  let element;
  if (args.type === "promotional") {
    if (!args.offerLines.some((l) => l.kind === "offer_price" || l.kind === "group_price")) throw new AppError("OUTRO_NEEDS_OFFER", "The promotional outro needs a price or group-buy offer in the brief.", 422);
    element = createElement(PromotionalOutro, { ...common, offer: args.offerLines });
    fonts.push({ lang: args.lang, weight: 700, text: args.cta }, ...args.offerLines.map((l) => ({ lang: "en" as const, weight: 700, text: l.text })));
  } else if (args.type === "product") {
    const asset = args.product ? getAsset(args.product.assetId) : undefined;
    if (!asset || !args.product) throw new AppError("OUTRO_NEEDS_PRODUCT", "The product outro needs a product photo.", 422);
    element = createElement(ProductOutro, { ...common, product: { src: pathToFileURL(absolutePath(asset)).href, width: asset.width!, height: asset.height! }, productName: args.product.name, price: args.product.price });
    fonts.push({ lang: args.lang, weight: 700, text: args.cta }, { lang: "en", weight: 700, text: args.product.name + (args.product.price ?? "") });
  } else {
    element = createElement(MinimalOutro, common);
  }
  await renderer.render({ width: frame.width, height: frame.height, css: "", bodyHtml: renderToStaticMarkup(element), fonts, outFile: args.outFile });
  return { file: args.outFile, inputHash: sha256(JSON.stringify({ v: 1, type: args.type, frame, cta: args.cta, offer: args.offerLines, product: args.product, logo: logo?.asset.sha256 ?? args.brand.tokens.name, colors })) };
}

export const PRODUCT_CANVAS_SCALE = 1.12;

/** Original product photo on the brand backdrop, rendered larger than the frame for camera motion. */
export async function renderProductCanvas(args: { brand: Brand; platform: PlatformKey; productAssetId: string; outFile: string; canvasScale?: number }): Promise<RenderedPng & { width: number; height: number }> {
  const frame = frameFor(args.platform);
  const colors = brandColors(args.brand);
  const asset = getAsset(args.productAssetId);
  if (!asset || asset.kind !== "image") throw new AppError("PRODUCT_IMAGE_MISSING", "Product image not found", 422);
  const canvasScale = args.canvasScale ?? PRODUCT_CANVAS_SCALE;
  const W = Math.round(frame.width * canvasScale);
  const H = Math.round(frame.height * canvasScale);
  const transparent = asset.mime === "image/png" && (await hasAlpha(absolutePath(asset)));
  const bodyHtml = renderToStaticMarkup(
    createElement(ProductStill, { frame, colors, canvasScale, product: { src: pathToFileURL(absolutePath(asset)).href, width: asset.width!, height: asset.height!, transparent } }),
  );
  await renderer.render({ width: W, height: H, css: "", bodyHtml, fonts: [], outFile: args.outFile });
  return { file: args.outFile, width: W, height: H, inputHash: sha256(JSON.stringify({ v: 1, frame, canvasScale, product: asset.sha256 })) };
}

async function hasAlpha(file: string): Promise<boolean> {
  const sharp = (await import("sharp")).default;
  const stats = await sharp(file).stats();
  return !stats.isOpaque;
}
