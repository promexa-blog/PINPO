"use client";

import { OverlayLayer, type LayoutVariant, type OverlayLine } from "@/lib/brand-layout/components";
import type { BrandColors } from "@/lib/brand-layout/tokens";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";

/**
 * WYSIWYG frame preview (plan §13): the SAME OverlayLayer component the renderer uses, at full
 * frame size, scaled to fit. Safe-area guides show where platform UI covers the video.
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
}: {
  platform: PlatformKey;
  colors: BrandColors;
  lang: "en" | "ml" | "hi";
  layout: LayoutVariant;
  lines: OverlayLine[];
  productSrc: string | null;
  aiScene: boolean;
  width?: number;
}) {
  const p = PLATFORMS[platform];
  const scale = width / p.width;
  const frame = { width: p.width, height: p.height, safe: p.safe };
  const placeholder = lines.some((l) => l.kind === "placeholder");
  return (
    <figure className="shrink-0" style={{ width }}>
      <div className="relative overflow-hidden rounded-md border border-dm-border bg-dm-surface" style={{ width, height: p.height * scale }} aria-hidden>
        <div style={{ position: "absolute", left: 0, top: 0, width: p.width, height: p.height, transform: `scale(${scale})`, transformOrigin: "0 0", background: `linear-gradient(180deg, ${colors.surface}, ${colors.secondaryLight})` }}>
          {aiScene ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: colors.secondary, fontSize: 48, fontFamily: '"PINPO Sans", sans-serif', background: "repeating-linear-gradient(135deg, #E8EEF1 0 40px, #F7F9FA 40px 80px)" }}>AI footage</div>
          ) : productSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={productSrc} alt="" style={{ position: "absolute", left: "50%", top: "47%", transform: "translate(-50%,-50%)", maxWidth: "75%", maxHeight: "55%", objectFit: "contain" }} />
          ) : null}
          {!placeholder ? <OverlayLayer frame={frame} colors={colors} lang={lang} layout={layout} lines={lines} /> : null}
          <div style={{ position: "absolute", left: p.width * p.safe.left, right: p.width * p.safe.right, top: p.height * p.safe.top, bottom: p.height * p.safe.bottom, outline: `${Math.max(2, 2 / scale)}px dashed rgba(82,105,121,0.7)` }} />
        </div>
      </div>
      <figcaption className="mt-1 text-[11px] text-dm-secondary">{placeholder ? "Preview after placeholders are filled" : "Preview · dashed line = safe area"}</figcaption>
    </figure>
  );
}
