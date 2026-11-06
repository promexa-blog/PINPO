import type { CSSProperties } from "react";
import { FONT_STACK, SCALE, fitSize, px, safeBox, unit, type BrandColors, type Frame } from "./tokens";

/**
 * Brand-layer components. Rendered to PNG by the worker (renderToStaticMarkup → Chrome) and
 * reused by the editor preview, so the preview matches the final video. Text is always a React
 * text node (escaped) — never HTML (plan §1 [v2.2]).
 */

type Lang = "en" | "ml" | "hi";
export type LayoutVariant = "lower_third" | "centered" | "side_panel" | "corner_badge" | "split_headline";

export interface OverlayLine {
  kind: "product_name" | "claim" | "offer_price" | "offer_mrp" | "offer_discount" | "offer_validity" | "cta" | "placeholder";
  text: string;
}

const abs = (s: CSSProperties): CSSProperties => ({ position: "absolute", ...s });

function Cta({ text, frame, colors, lang, inverse }: { text: string; frame: Frame; colors: BrandColors; lang: Lang; inverse?: boolean }) {
  const size = fitSize(px(frame, SCALE.cta), text, 26);
  return (
    <div
      data-role="cta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: unit(frame, 1.5),
        minHeight: Math.round(frame.height * 0.06 * (frame.height > frame.width ? 0.75 : 1)),
        padding: `0 ${unit(frame, 4)}px`,
        borderRadius: 9999,
        background: inverse ? colors.secondaryLight : colors.primary,
        color: inverse ? colors.primary : colors.white,
        fontFamily: FONT_STACK[lang],
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "clip" }}>{text}</span>
      <span aria-hidden style={{ fontFamily: FONT_STACK.en }}>→</span>
    </div>
  );
}

function Offer({ lines, frame, colors }: { lines: OverlayLine[]; frame: Frame; colors: BrandColors }) {
  const price = lines.find((l) => l.kind === "offer_price");
  const mrp = lines.find((l) => l.kind === "offer_mrp");
  const discount = lines.find((l) => l.kind === "offer_discount");
  const validity = lines.find((l) => l.kind === "offer_validity");
  if (!price) return null;
  return (
    <div data-role="offer" style={{ background: colors.primary, color: colors.white, borderRadius: unit(frame, 2), padding: `${unit(frame, 2)}px ${unit(frame, 3)}px`, fontFamily: FONT_STACK.en }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: unit(frame, 2), flexWrap: "wrap" }}>
        <span style={{ fontSize: px(frame, SCALE.headline), fontWeight: 800, lineHeight: 1.05 }}>{price.text}</span>
        {mrp ? <span style={{ fontSize: px(frame, SCALE.body), color: colors.secondaryLight, textDecoration: "line-through", fontWeight: 600 }}>{mrp.text}</span> : null}
      </div>
      {discount ? (
        <div style={{ marginTop: unit(frame, 1), display: "inline-block", background: colors.secondaryLight, color: colors.primary, borderRadius: 9999, padding: `${unit(frame, 0.6)}px ${unit(frame, 2)}px`, fontSize: px(frame, SCALE.body), fontWeight: 700 }}>
          {discount.text}
        </div>
      ) : null}
      {validity ? <div style={{ marginTop: unit(frame, 1), fontSize: px(frame, SCALE.caption), color: colors.secondaryLight, fontWeight: 500 }}>{validity.text}</div> : null}
    </div>
  );
}

export function OverlayLayer({ frame, colors, lang, layout, lines }: { frame: Frame; colors: BrandColors; lang: Lang; layout: LayoutVariant; lines: OverlayLine[] }) {
  const box = safeBox(frame);
  const textLines = lines.filter((l) => l.kind === "product_name" || l.kind === "claim" || l.kind === "placeholder");
  const cta = lines.find((l) => l.kind === "cta");
  const hasOffer = lines.some((l) => l.kind === "offer_price");
  const isHeadline = textLines.some((l) => l.kind === "product_name");
  const font = FONT_STACK[lang];
  const letterSpacing = lang === "en" ? "-0.01em" : 0;
  const text = (style: CSSProperties) =>
    textLines.map((l, i) => (
      <div key={i} data-role="text" style={{ fontFamily: font, fontWeight: 700, lineHeight: lang === "en" ? 1.15 : 1.3, letterSpacing, ...style }}>
        {l.text}
      </div>
    ));
  const headSize = (t: string) => fitSize(px(frame, isHeadline ? SCALE.headline : SCALE.subheadline + 0.6), t, isHeadline ? 18 : 34);
  const firstText = textLines[0]?.text ?? "";

  if (layout === "corner_badge" || hasOffer) {
    return (
      <div style={abs({ inset: 0 })}>
        {hasOffer ? (
          <div style={abs({ top: box.top, right: box.right, maxWidth: box.width * 0.7 })}>
            <Offer lines={lines} frame={frame} colors={colors} />
          </div>
        ) : null}
        {textLines.length ? (
          <div style={abs({ left: box.left, top: box.top + (hasOffer ? box.height * 0.32 : 0), maxWidth: box.width * 0.8, background: colors.white, color: colors.primary, borderRadius: unit(frame, 2), padding: `${unit(frame, 1.5)}px ${unit(frame, 2.5)}px` })}>
            {text({ fontSize: headSize(firstText) })}
          </div>
        ) : null}
        {cta ? (
          <div style={abs({ left: box.left, right: box.right, bottom: box.bottom, display: "flex", justifyContent: "center" })}>
            <Cta text={cta.text} frame={frame} colors={colors} lang={lang} />
          </div>
        ) : null}
      </div>
    );
  }

  if (layout === "centered") {
    return (
      <div style={abs({ inset: 0, display: "flex", alignItems: "center", justifyContent: "center" })}>
        <div style={{ maxWidth: box.width, textAlign: "center", background: colors.secondaryLight, color: colors.primary, borderRadius: unit(frame, 2.5), padding: `${unit(frame, 2)}px ${unit(frame, 3.5)}px`, display: "flex", flexDirection: "column", alignItems: "center", gap: unit(frame, 2) }}>
          {text({ fontSize: headSize(firstText) })}
          {cta ? <Cta text={cta.text} frame={frame} colors={colors} lang={lang} /> : null}
        </div>
      </div>
    );
  }

  if (layout === "split_headline") {
    return (
      <div style={abs({ left: box.left, top: box.top + box.height * 0.18, maxWidth: box.width * 0.78 })}>
        <div style={{ width: unit(frame, 1.2), height: unit(frame, 10), background: colors.primary, borderRadius: 9999, marginBottom: unit(frame, 1.5) }} />
        <div style={{ background: colors.white, color: colors.primary, borderRadius: unit(frame, 2), padding: `${unit(frame, 1.5)}px ${unit(frame, 2.5)}px` }}>{text({ fontSize: headSize(firstText) })}</div>
        {cta ? (
          <div style={{ marginTop: unit(frame, 2) }}>
            <Cta text={cta.text} frame={frame} colors={colors} lang={lang} />
          </div>
        ) : null}
      </div>
    );
  }

  if (layout === "side_panel" && frame.width > frame.height) {
    return (
      <div style={abs({ top: box.top, bottom: box.bottom, right: box.right, width: box.width * 0.36, background: colors.white, color: colors.primary, borderRadius: unit(frame, 2), padding: unit(frame, 3), display: "flex", flexDirection: "column", justifyContent: "center", gap: unit(frame, 2) })}>
        {text({ fontSize: headSize(firstText) })}
        {cta ? <Cta text={cta.text} frame={frame} colors={colors} lang={lang} /> : null}
      </div>
    );
  }

  // lower_third (default)
  return (
    <div style={abs({ left: box.left, right: box.right, bottom: box.bottom, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: unit(frame, 1.5) })}>
      {textLines.length ? (
        <div style={{ maxWidth: box.width, background: colors.primary, color: colors.white, borderRadius: unit(frame, 2), padding: `${unit(frame, 1.6)}px ${unit(frame, 2.6)}px` }}>
          {text({ fontSize: headSize(firstText) })}
        </div>
      ) : null}
      {cta ? <Cta text={cta.text} frame={frame} colors={colors} lang={lang} inverse /> : null}
    </div>
  );
}

export interface OutroProps {
  frame: Frame;
  colors: BrandColors;
  lang: Lang;
  logo: { src: string; width: number; height: number; maxScale: number };
  tagline: string;
  cta: string;
  website: string;
}

/** Standard DemandMesh outro (plan §6): logo, tagline, CTA pill, website on white. */
export function StandardOutro({ frame, colors, lang, logo, tagline, cta, website }: OutroProps) {
  const box = safeBox(frame);
  const maxLogoW = Math.min(Math.round(logo.width * logo.maxScale), Math.round(box.width * 0.7));
  const logoW = maxLogoW;
  const logoH = Math.round((logo.height / logo.width) * logoW);
  return (
    <div style={abs({ inset: 0, background: colors.white, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: unit(frame, 3) })}>
      {/* eslint-disable-next-line @next/next/no-img-element -- official logo file, exact pixels */}
      <img data-role="logo" src={logo.src} width={logoW} height={logoH} alt="DemandMesh" style={{ display: "block", width: logoW, height: logoH }} />
      <div data-role="tagline" style={{ fontFamily: FONT_STACK.en, color: colors.secondary, fontSize: px(frame, SCALE.subheadline), fontWeight: 500 }}>
        {tagline}
      </div>
      <Cta text={cta} frame={frame} colors={colors} lang={lang} />
      <div data-role="website" style={{ fontFamily: FONT_STACK.en, color: colors.primary, fontSize: px(frame, SCALE.body), fontWeight: 700, letterSpacing: "0.01em" }}>
        {website}
      </div>
    </div>
  );
}

export interface ProductStillProps {
  frame: Frame;
  colors: BrandColors;
  product: { src: string; width: number; height: number; transparent: boolean };
  /** Extra canvas around the frame for camera motion headroom (e.g. 1.12). */
  canvasScale: number;
}

/**
 * Original product photo on a brand backdrop (plan §7). The photo is never stretched: it's fitted
 * inside the safe area with its exact aspect ratio, and never shown above native size × 1.25.
 */
export function ProductStill({ frame, colors, product, canvasScale }: ProductStillProps) {
  const W = Math.round(frame.width * canvasScale);
  const H = Math.round(frame.height * canvasScale);
  const box = safeBox(frame);
  const maxW = box.width * 0.86 * canvasScale;
  const maxH = box.height * 0.62 * canvasScale;
  const scale = Math.min(maxW / product.width, maxH / product.height, 1.25 * canvasScale);
  const w = Math.round(product.width * scale);
  const h = Math.round(product.height * scale);
  return (
    <div style={abs({ left: 0, top: 0, width: W, height: H, background: `linear-gradient(180deg, ${colors.surface} 0%, ${colors.secondaryLight} 100%)` })}>
      <div style={abs({ left: (W - w) / 2, top: (H - h) / 2 - H * 0.03, width: w, height: h })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- exact original pixels */}
        <img
          data-role="product"
          src={product.src}
          width={w}
          height={h}
          alt=""
          style={{
            display: "block",
            width: w,
            height: h,
            borderRadius: product.transparent ? 0 : Math.round(Math.min(w, h) * 0.03),
            boxShadow: product.transparent ? "none" : `0 ${Math.round(h * 0.03)}px ${Math.round(h * 0.08)}px rgba(12,28,40,0.18)`,
            filter: product.transparent ? `drop-shadow(0 ${Math.round(h * 0.02)}px ${Math.round(h * 0.04)}px rgba(12,28,40,0.18))` : "none",
          }}
        />
      </div>
    </div>
  );
}

/** The product's rectangle in frame coordinates at the motion's hold point (used by P1 checks). */
export function productRect(frame: Frame, product: { width: number; height: number }, canvasScale: number) {
  const box = safeBox(frame);
  const scale = Math.min((box.width * 0.86 * canvasScale) / product.width, (box.height * 0.62 * canvasScale) / product.height, 1.25 * canvasScale);
  const W = frame.width * canvasScale;
  const H = frame.height * canvasScale;
  const w = Math.round(product.width * scale);
  const h = Math.round(product.height * scale);
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2 - H * 0.03), w, h, canvasW: Math.round(W), canvasH: Math.round(H) };
}
