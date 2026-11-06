import "../guard";
import path from "node:path";
import sharp from "sharp";
import { productRect } from "@/lib/brand-layout/components";
import type { Frame } from "@/lib/brand-layout/tokens";
import { extractFrame } from "./clips";
import { ffmpeg } from "./run";

/**
 * Product-preservation measurement (plan §7 [v2.2]): decode the hold frame, crop the known product
 * rectangle, compare with the reference scaled to the same size. Tolerates resizing, colour
 * conversion and H.264 4:2:0 compression; thresholds: mean ΔE2000 ≤ 3, P95 ≤ 8, SSIM ≥ 0.92.
 */

export interface ProductCompare {
  meanDeltaE: number;
  p95DeltaE: number;
  ssim: number;
  aspectError: number;
  rect: { x: number; y: number; w: number; h: number };
}

export const PRODUCT_THRESHOLDS = { meanDeltaE: 3, p95DeltaE: 8, ssim: 0.92, aspectError: 0.005 } as const;

export async function compareProductRegion(o: {
  clip: string;
  holdS: number;
  frame: Frame;
  productFile: string;
  productSize: { width: number; height: number };
  canvasScale: number;
  /** Zoom of the push-in at the hold point (1.08 for push-in). */
  zoomAtHold: number;
  workDir: string;
}): Promise<ProductCompare> {
  const r = productRect(o.frame, o.productSize, o.canvasScale);
  // Canvas → frame: the canvas is fitted to the frame width then zoomed and centre-cropped.
  const s = (o.frame.width / r.canvasW) * o.zoomAtHold;
  const scaledW = r.canvasW * s;
  const scaledH = r.canvasH * s;
  const offX = (scaledW - o.frame.width) / 2;
  const offY = (scaledH - o.frame.height) / 2;
  // Inset 4% to stay clear of rounded corners and the drop shadow.
  const inset = 0.04;
  const x = Math.round(r.x * s - offX + r.w * s * inset);
  const y = Math.round(r.y * s - offY + r.h * s * inset);
  const w = Math.round(r.w * s * (1 - 2 * inset));
  const h = Math.round(r.h * s * (1 - 2 * inset));
  const framePng = path.join(o.workDir, `hold-${Date.now()}.png`);
  await extractFrame(o.clip, o.holdS, framePng);

  const got = await sharp(framePng).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer();
  const refCropX = Math.round(o.productSize.width * inset);
  const refCropY = Math.round(o.productSize.height * inset);
  // Keep alpha: cut-outs are compared only inside the product mask (plan §7 [v2.2]).
  const refRgba = await sharp(o.productFile)
    .extract({ left: refCropX, top: refCropY, width: o.productSize.width - 2 * refCropX, height: o.productSize.height - 2 * refCropY })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const deltas: number[] = [];
  const composited = Buffer.alloc(w * h * 3);
  for (let px = 0, q = 0; px < w * h; px++, q += 3) {
    const a = refRgba[px * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) composited[q + c] = Math.round(a * refRgba[px * 4 + c]! + (1 - a) * got[q + c]!);
    if (a >= 0.98) deltas.push(deltaE2000(rgbToLab(refRgba[px * 4]!, refRgba[px * 4 + 1]!, refRgba[px * 4 + 2]!), rgbToLab(got[q]!, got[q + 1]!, got[q + 2]!)));
  }
  if (deltas.length < 100) throw new Error("Product mask is (almost) empty — can't measure the product");
  deltas.sort((a, b) => a - b);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const p95 = deltas[Math.floor(deltas.length * 0.95)]!;

  // SSIM on the reference composited over the rendered backdrop (transparent areas compare equal).
  const refPng = path.join(o.workDir, `ref-${Date.now()}.png`);
  const gotPng = path.join(o.workDir, `got-${Date.now()}.png`);
  await sharp(composited, { raw: { width: w, height: h, channels: 3 } }).png().toFile(refPng);
  await sharp(got, { raw: { width: w, height: h, channels: 3 } }).png().toFile(gotPng);
  const ssim = await ssimOf(refPng, gotPng);
  const expectedAspect = o.productSize.width / o.productSize.height;
  const renderedAspect = r.w / r.h;
  return { meanDeltaE: mean, p95DeltaE: p95, ssim, aspectError: Math.abs(renderedAspect - expectedAspect) / expectedAspect, rect: { x, y, w, h } };
}

async function ssimOf(a: string, b: string): Promise<number> {
  const { stderrTail } = await ffmpeg(["-i", a, "-i", b, "-lavfi", "[0:v]format=gray[a];[1:v]format=gray[b];[a][b]ssim", "-f", "null", "-"]);
  const m = /All:([\d.]+)/.exec(stderrTail);
  return m ? Number(m[1]) : 0;
}

// --- colour science (sRGB D65 → CIELAB, CIEDE2000) ---
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function deltaE2000([L1, a1, b1]: [number, number, number], [L2, a2, b2]: [number, number, number]): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
