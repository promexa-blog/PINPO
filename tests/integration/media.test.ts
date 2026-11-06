import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { paths } from "@/server/paths";
import { renderer } from "@/server/render/browser";
import { seedBundledBrand, type Brand } from "@/server/brand/kits";
import { renderOverlay, renderProductCanvas, renderStandardOutro, PRODUCT_CANVAS_SCALE } from "@/server/render/brand-render";
import { normalizeClip, productClip, outroClip, extractFrame, PUSH_IN_ZOOM } from "@/server/media/clips";
import { buildComposeGraph } from "@/server/media/filtergraph";
import { validateFinal, validateClip } from "@/server/media/validate";
import { ffmpeg } from "@/server/media/run";
import { computeTimeline } from "@/server/planning/timeline";
import { storeUpload } from "@/server/storage/upload";
import { absolutePath } from "@/server/storage/assets";
import { productRect } from "@/lib/brand-layout/components";
import { PLATFORMS } from "@/lib/platforms";
import { UploadMeta } from "@/lib/schemas";
import { compareProductRegion } from "@/server/media/product-check";

const W = 1080;
const H = 1920;
const dir = path.join(paths.work, "media-test");
const p = (n: string) => path.join(dir, n);
let brand: Brand;
let productId: string;

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  brand = (await seedBundledBrand())!;
  // A recognisable "product" photo: coloured bands + a dark label block.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#d35400"/><rect y="400" width="900" height="400" fill="#2e86c1"/><rect x="250" y="520" width="400" height="160" fill="#1b2631"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const asset = await storeUpload(png, "product.png", UploadMeta.parse({ purpose: "product_image", provenance: { sourceType: "own_photo", commercialUse: "yes", permissionConfirmed: true } }));
  productId = asset.id;
});
afterAll(async () => renderer.close());

describe("media pipeline", () => {
  it("animates the original product without changing it (P1 thresholds)", async () => {
    const canvas = await renderProductCanvas({ brand, platform: "instagram_reels", productAssetId: productId, outFile: p("canvas.png") });
    await productClip(canvas.file, p("product.mp4"), { width: W, height: H, durationS: 3, motion: "push-in", canvasScale: PRODUCT_CANVAS_SCALE });
    const v = await validateClip(p("product.mp4"), { requestedS: 3, minShortSide: 1080, expectAudio: true });
    expect(v.ok).toBe(true);
    const result = await compareProductRegion({
      clip: p("product.mp4"),
      holdS: 2.9,
      frame: { width: W, height: H, safe: PLATFORMS.instagram_reels.safe },
      productFile: absolutePath({ path: (await import("@/server/storage/assets")).getAsset(productId)!.path }),
      productSize: { width: 900, height: 1200 },
      canvasScale: PRODUCT_CANVAS_SCALE,
      zoomAtHold: PUSH_IN_ZOOM,
      workDir: dir,
    });
    expect(result.meanDeltaE).toBeLessThanOrEqual(3);
    expect(result.p95DeltaE).toBeLessThanOrEqual(8);
    expect(result.ssim).toBeGreaterThanOrEqual(0.92);
    expect(result.aspectError).toBeLessThanOrEqual(0.005);
  }, 120_000);

  it("measures a transparent cut-out only inside its mask (P1 cut-out)", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect x="150" y="100" width="500" height="800" rx="50" fill="#b8c1c8"/><rect x="150" y="380" width="500" height="14" fill="#7f8c95"/><rect x="320" y="30" width="160" height="90" rx="16" fill="#1b2631"/></svg>`;
    const png = await sharp({ create: { width: 800, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    const asset = await storeUpload(png, "cutout.png", UploadMeta.parse({ purpose: "product_image", provenance: { sourceType: "own_photo", commercialUse: "yes", permissionConfirmed: true } }));
    const canvas = await renderProductCanvas({ brand, platform: "instagram_reels", productAssetId: asset.id, outFile: p("cut-canvas.png") });
    await productClip(canvas.file, p("cut.mp4"), { width: W, height: H, durationS: 3, motion: "push-in", canvasScale: PRODUCT_CANVAS_SCALE });
    const r = await compareProductRegion({ clip: p("cut.mp4"), holdS: 2.9, frame: { width: W, height: H, safe: PLATFORMS.instagram_reels.safe }, productFile: absolutePath(asset), productSize: { width: 800, height: 1000 }, canvasScale: PRODUCT_CANVAS_SCALE, zoomAtHold: PUSH_IN_ZOOM, workDir: dir });
    expect(r.meanDeltaE).toBeLessThanOrEqual(3);
    expect(r.ssim).toBeGreaterThanOrEqual(0.92);
  }, 120_000);

  it("composes scenes + overlays + outro + ducked music to an exact, valid final (I1 core)", async () => {
    // Two "AI" clips (test sources) of awkward sizes/durations + the product clip from above.
    await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=24:d=5", "-f", "lavfi", "-i", "sine=f=330:d=5", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", p("ai1.mp4")]);
    await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc=s=1280x720:r=25:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", p("ai2.mp4")]);
    await normalizeClip(p("ai1.mp4"), p("n1.mp4"), { width: W, height: H, durationS: 4, keepAudio: true, sourceHasAudio: true });
    await normalizeClip(p("ai2.mp4"), p("n2.mp4"), { width: W, height: H, durationS: 3.5, keepAudio: true, sourceHasAudio: false }); // shorter than planned → freeze-extended
    const outroPng = await renderStandardOutro({ brand, platform: "instagram_reels", lang: "en", cta: "Shop now on demandmesh.shop", outFile: p("outro.png") });
    await outroClip(outroPng.file, p("outro.mp4"), { width: W, height: H, durationS: 3 });
    await renderOverlay({ brand, platform: "instagram_reels", lang: "en", layout: "centered", lines: [{ kind: "product_name", text: "Steel Lunch Box" }], outFile: p("ov0.png") });
    await renderOverlay({ brand, platform: "instagram_reels", lang: "ml", layout: "lower_third", lines: [{ kind: "claim", text: "ഭക്ഷണം വേർതിരിച്ച് സൂക്ഷിക്കുന്നു" }], outFile: p("ov1.png") });
    await renderOverlay({
      brand,
      platform: "instagram_reels",
      lang: "en",
      layout: "corner_badge",
      lines: [{ kind: "offer_price", text: "₹899" }, { kind: "offer_mrp", text: "₹1,299" }, { kind: "offer_discount", text: "30% off" }, { kind: "cta", text: "Shop now on demandmesh.shop" }],
      outFile: p("ov2.png"),
    });
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=f=220:d=20", "-c:a", "libmp3lame", "-b:a", "128k", p("music.mp3")]).catch(async () =>
      ffmpeg(["-y", "-f", "lavfi", "-i", "sine=f=220:d=20", "-c:a", "aac", p("music.m4a")]),
    );

    const durations = [3, 4, 3.5];
    const transitions = [0.4, 0.4, 0.5];
    const tl = computeTimeline({ scenes: durations.map((d, i) => ({ durationS: d, transitionOutS: transitions[i]! })), outroS: 3 });
    expect(tl.totalS).toBeCloseTo(12.2, 5);
    const g = buildComposeGraph({
      timeline: tl,
      transitions: ["crossfade", "dip_white", "crossfade"],
      overlays: tl.segments.map((s) => ({ startS: s.startS + 0.25, endS: s.endS - s.transitionOutS - 0.05, motion: "fade-up" as const })),
      width: W,
      height: H,
      audioMode: "mix",
      hasMusic: true,
      musicVolumeDb: -6,
    });
    const music = (await import("node:fs")).existsSync(p("music.mp3")) ? p("music.mp3") : p("music.m4a");
    await ffmpeg([
      "-y",
      "-i", p("product.mp4"), "-i", p("n1.mp4"), "-i", p("n2.mp4"), "-i", p("outro.mp4"),
      ...["ov0", "ov1", "ov2"].flatMap((o) => ["-loop", "1", "-framerate", "30", "-t", String(tl.totalS), "-i", p(`${o}.png`)]),
      "-stream_loop", "-1", "-i", music,
      "-filter_complex", g.filter, "-map", g.videoOut, "-map", g.audioOut,
      "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", String(tl.totalS), "-movflags", "+faststart", p("final.mp4"),
    ]);
    const v = await validateFinal(p("final.mp4"), { width: W, height: H, durationS: tl.totalS }, { expectSound: true });
    const failed = v.checks.filter((c) => c.status === "fail");
    expect(failed).toEqual([]);
    await extractFrame(p("final.mp4"), 1.5, p("frame-1.5.png"));
    await extractFrame(p("final.mp4"), 11.5, p("frame-outro.png"));
  }, 300_000);
});
