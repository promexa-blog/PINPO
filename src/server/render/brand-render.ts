import "../guard";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import type { Lang } from "@/lib/brief";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import type { BrandColors, Frame } from "@/lib/brand-layout/tokens";
import { OverlayLayer, ProductStill, StandardOutro, type LayoutVariant, type OverlayLine } from "@/lib/brand-layout/components";
import type { MasterBrand } from "../brand/master";
import { absolutePath, getAsset } from "../storage/assets";
import { AppError, sha256 } from "../util";
import { renderer, type FontNeed } from "./browser";

/** Renders brand-layer graphics (overlays, outro, product canvas) to PNG via the pinned Chrome. */

export function frameFor(platform: PlatformKey): Frame {
  const p = PLATFORMS[platform];
  return { width: p.width, height: p.height, safe: p.safe };
}

export function brandColors(brand: MasterBrand): BrandColors {
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
export function assertTokenColors(colors: BrandColors, brand: MasterBrand): void {
  const allowed = new Set(Object.values(brand.tokens.colors).map((v) => v.toUpperCase()));
  for (const [k, v] of Object.entries(colors)) {
    if (!allowed.has(v.toUpperCase())) throw new AppError("BRAND_COLOR", `Colour ${k}=${v} is not a DemandMesh brand token`, 422);
  }
}

/** Official logo with pinned-hash verification — the renderer refuses anything else (plan §3). */
export function officialLogo(brand: MasterBrand) {
  const logo = brand.logos.find((l) => l.variant === "horizontal");
  if (!logo) throw new AppError("LOGO_MISSING", "No official horizontal logo", 500);
  const asset = getAsset(logo.assetId);
  if (!asset || asset.sha256 !== logo.pinnedSha256 || !asset.official) throw new AppError("LOGO_NOT_OFFICIAL", "Logo file does not match the pinned official logo", 500);
  const spec = brand.tokens.logo.horizontal;
  return { asset, src: pathToFileURL(absolutePath(asset)).href, width: asset.width!, height: asset.height!, maxScale: spec?.maxScale ?? 1.25 };
}

export interface RenderedPng {
  file: string;
  /** Hash of the inputs, used as cache key and QA evidence. */
  inputHash: string;
}

export async function renderOverlay(args: {
  brand: MasterBrand;
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
  const fonts: FontNeed[] = lines.map((l) => ({ lang: /^offer_/.test(l.kind) ? "en" : args.lang, weight: 700, text: l.text }));
  await renderer.render({ width: frame.width, height: frame.height, transparent: true, css: "", bodyHtml, fonts, outFile: args.outFile });
  return { file: args.outFile, inputHash: sha256(JSON.stringify({ v: 1, f: frame, l: args.layout, lang: args.lang, lines })) };
}

export async function renderStandardOutro(args: { brand: MasterBrand; platform: PlatformKey; lang: Lang; cta: string; outFile: string }): Promise<RenderedPng> {
  const frame = frameFor(args.platform);
  const colors = brandColors(args.brand);
  const logo = officialLogo(args.brand);
  const website = args.brand.tokens.website;
  if (website !== "demandmesh.shop") throw new AppError("OUTRO_WEBSITE", "Outro website must be exactly demandmesh.shop", 500);
  const bodyHtml = renderToStaticMarkup(
    createElement(StandardOutro, { frame, colors, lang: args.lang, logo: { src: logo.src, width: logo.width, height: logo.height, maxScale: logo.maxScale }, tagline: args.brand.tokens.tagline, cta: args.cta, website }),
  );
  await renderer.render({
    width: frame.width,
    height: frame.height,
    css: "",
    bodyHtml,
    fonts: [
      { lang: "en", weight: 500, text: args.brand.tokens.tagline },
      { lang: args.lang, weight: 700, text: args.cta },
      { lang: "en", weight: 700, text: website },
    ],
    outFile: args.outFile,
  });
  return { file: args.outFile, inputHash: sha256(JSON.stringify({ v: 1, frame, cta: args.cta, logo: logo.asset.sha256, website, tag: args.brand.tokens.tagline })) };
}

export const PRODUCT_CANVAS_SCALE = 1.12;

/** Original product photo on the brand backdrop, rendered larger than the frame for camera motion. */
export async function renderProductCanvas(args: { brand: MasterBrand; platform: PlatformKey; productAssetId: string; outFile: string; canvasScale?: number }): Promise<RenderedPng & { width: number; height: number }> {
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
