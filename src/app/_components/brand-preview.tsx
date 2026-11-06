import type { ReactNode } from "react";
import { OverlayLayer, StandardOutro } from "@/lib/brand-layout/components";
import type { BrandColors } from "@/lib/brand-layout/tokens";
import { PLATFORMS } from "@/lib/platforms";

export interface PreviewBrand {
  name: string;
  website: string;
  tagline: string;
  colors: Record<string, string>;
  logo: { src: string; width: number; height: number } | null;
  cta: string;
}

const REELS = PLATFORMS.instagram_reels;
const FRAME = { width: REELS.width, height: REELS.height, safe: REELS.safe };

/** The brand's real outro and overlay at 9:16 — the same components the video renderer uses. */
export function BrandPreview({ brand, width = 200, show = "both" }: { brand: PreviewBrand; width?: number; show?: "both" | "outro" }) {
  const colors = brand.colors as unknown as BrandColors;
  const scale = width / FRAME.width;
  const box = (children: ReactNode, label: string, bg?: string) => (
    <figure className="shrink-0" style={{ width }}>
      <div className="relative overflow-hidden rounded-md shadow-lift ring-1 ring-line" style={{ width, height: FRAME.height * scale }} aria-hidden>
        <div style={{ position: "absolute", left: 0, top: 0, width: FRAME.width, height: FRAME.height, transform: `scale(${scale})`, transformOrigin: "0 0", background: bg }}>{children}</div>
      </div>
      <figcaption className="mt-1.5 text-center text-[11px] text-ink-3">{label}</figcaption>
    </figure>
  );
  const outro = box(
    <StandardOutro frame={FRAME} colors={colors} lang="en" logo={brand.logo ? { ...brand.logo, maxScale: 1.25 } : null} brandName={brand.name || "Your brand"} tagline={brand.tagline} cta={brand.cta || "Shop now"} website={brand.website || "yourshop.com"} />,
    "Ending",
  );
  if (show === "outro") return outro;
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {box(
        <OverlayLayer
          frame={FRAME}
          colors={colors}
          lang="en"
          layout="lower_third"
          lines={[
            { kind: "product_name", text: "Your product" },
            { kind: "claim", text: "A benefit you confirmed" },
          ]}
        />,
        "On-screen text",
        "repeating-linear-gradient(135deg, #3a3f46 0 46px, #33383f 46px 92px)",
      )}
      {outro}
    </div>
  );
}
