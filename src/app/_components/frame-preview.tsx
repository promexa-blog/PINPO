"use client";

import { OverlayLayer, type LayoutVariant, type OverlayLine } from "@/lib/brand-layout/components";
import type { BrandColors } from "@/lib/brand-layout/tokens";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";

/**
 * WYSIWYG frame preview (plan §13): the SAME OverlayLayer component the renderer uses, at full
 * frame size, scaled to fit. The dashed line marks the platform's text-safe area.
 */
export function FramePreview({
  platform,
  colors,
  lang,
  layout,
  lines,
  productSrc,
  aiScene,
  width = 180,
  caption,
  guides = true,
}: {
  platform: PlatformKey;
  colors: BrandColors;
  lang: "en" | "ml" | "hi";
  layout: LayoutVariant;
  lines: OverlayLine[];
  productSrc: string | null;
  aiScene: boolean;
  width?: number;
  /** Compact caption (filmstrip); null hides it; omit for the full caption. */
  caption?: string | null;
  /** Dashed safe-area guide (off in the playback preview). */
  guides?: boolean;
}) {
  const p = PLATFORMS[platform];
  const scale = width / p.width;
  const frame = { width: p.width, height: p.height, safe: p.safe };
  const placeholder = lines.some((l) => l.kind === "placeholder");
  return (
    <figure className="shrink-0" style={{ width }}>
      <div className="relative overflow-hidden rounded-md bg-frame ring-1 ring-line" style={{ width, height: p.height * scale }} aria-hidden>
        <div style={{ position: "absolute", left: 0, top: 0, width: p.width, height: p.height, transform: `scale(${scale})`, transformOrigin: "0 0", background: aiScene ? "var(--panel-2)" : `linear-gradient(180deg, ${colors.surface}, ${colors.secondaryLight})` }}>
          {aiScene ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 54, fontWeight: 600, fontFamily: '"PINPO Sans", sans-serif', background: "repeating-linear-gradient(135deg, transparent 0 46px, color-mix(in oklch, var(--ink) 5%, transparent) 46px 92px)" }}>AI footage</div>
          ) : productSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={productSrc} alt="" style={{ position: "absolute", left: "50%", top: "47%", transform: "translate(-50%,-50%)", maxWidth: "75%", maxHeight: "55%", objectFit: "contain" }} />
          ) : null}
          {!placeholder ? <OverlayLayer frame={frame} colors={colors} lang={lang} layout={layout} lines={lines} /> : null}
          {guides ? <div style={{ position: "absolute", left: p.width * p.safe.left, right: p.width * p.safe.right, top: p.height * p.safe.top, bottom: p.height * p.safe.bottom, outline: `${Math.max(2, 1.5 / scale)}px dashed color-mix(in oklch, var(--accent) 60%, transparent)` }} /> : null}
        </div>
      </div>
      {caption === null ? null : caption !== undefined ? (
        <figcaption className="tabular mt-1 text-center text-[11px] font-semibold text-ink-3">{caption}</figcaption>
      ) : (
        <figcaption className="mt-1.5 text-[11px] leading-snug text-ink-3">{placeholder ? "Text shows once placeholders are filled" : "Dashed line: text-safe area"}</figcaption>
      )}
    </figure>
  );
}
