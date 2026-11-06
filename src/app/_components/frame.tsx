import type { ReactNode } from "react";
import type { Aspect } from "@/lib/platforms";

/** Aspect → CSS ratio. Every ad, scene and template in the studio is shown at its true shape. */
export const ASPECT_RATIO: Record<Aspect, string> = { "9:16": "9 / 16", "1:1": "1 / 1", "16:9": "16 / 9" };

/** A frame of the given aspect, fitted inside a fixed stage so mixed formats line up in a grid. */
export function Stage({ aspect, children, className = "", fit = "h" }: { aspect: Aspect; children?: ReactNode; className?: string; fit?: "h" | "w" }) {
  return (
    <div className={`grid place-items-center overflow-hidden bg-frame ${className}`}>
      <div
        className="relative overflow-hidden rounded-[5px] bg-sunken shadow-lift ring-1 ring-white/5"
        style={{ aspectRatio: ASPECT_RATIO[aspect], ...(aspect === "16:9" || fit === "w" ? { width: "88%" } : { height: "86%" }) }}
      >
        {children}
      </div>
    </div>
  );
}

/** Tiny proportional glyph of a format (used in pickers and meta lines). */
export function AspectGlyph({ aspect, size = 18 }: { aspect: Aspect; size?: number }) {
  const [w, h] = aspect === "9:16" ? [9, 16] : aspect === "16:9" ? [16, 9] : [12, 12];
  const k = size / 16;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <rect x={(16 - w) / 2} y={(16 - h) / 2} width={w} height={h} rx={1.6 / k} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
