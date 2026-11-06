import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { db, tx } from "@/server/db";
import { paths } from "@/server/paths";
import { PLATFORMS } from "@/lib/platforms";
import { getMasterBrand } from "@/server/brand/master";
import { renderOverlay, renderOutro, frameFor, officialLogo, brandColors, PRODUCT_CANVAS_SCALE } from "@/server/render/brand-render";
import { offerLine, formatInr } from "@/server/brief/offers";
import { groupBuyLines } from "@/server/planning/storyboard";
import { normalizeClip, outroClip, thumbnail, PUSH_IN_ZOOM } from "@/server/media/clips";
import { buildComposeGraph, type XfadeKind } from "@/server/media/filtergraph";
import { ffmpeg } from "@/server/media/run";
import { probe } from "@/server/media/probe";
import { validateFinal } from "@/server/media/validate";
import { compareProductRegion, PRODUCT_THRESHOLDS } from "@/server/media/product-check";
import { absolutePath, getAsset, putFile } from "@/server/storage/assets";
import { isDiskFullError } from "@/server/storage/disk";
import { getBrief, getScenes, requireVersion, settingsOf, finishingOf } from "@/server/db/repos/versions";
import { draftScenes, timelineFor, brandLines } from "@/server/planning/draft";
import { OUTRO_S } from "@/server/planning/storyboard";
import { complianceItems, type QaItem } from "@/server/qa/checks/compliance";
import { writeReport, refreshQaStatus } from "@/server/qa/reports";
import { indiaToday } from "@/server/brief/offers";
import { getModel } from "@/server/models/registry";
import { safeBox } from "@/lib/brand-layout/tokens";
import { AppError, now, sha256 } from "@/server/util";
import type { JobHandler, JobContext } from "../types";

/** Final composition (plan §6): normalize → brand graphics → encode → validate → finalize + QA. */
export const composeHandler: JobHandler = {
  type: "compose",
  concurrency: () => 1,
  async run(ctx) {
    const { versionId } = JSON.parse(ctx.job.input_json) as { versionId: string };
    if (ctx.job.cancel_requested) {
      ctx.transition({ status: "canceled", message: "canceled" });
      return;
    }
    const dir = path.join(paths.work, `${ctx.job.id}-a${ctx.job.attempt}`);
    await rm(dir, { recursive: true, force: true }); // interrupted compose restarts cleanly (plan §5)
    await mkdir(dir, { recursive: true });
    await mkdir(paths.cache, { recursive: true });
    try {
      await compose(ctx, versionId, dir);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      const job = ctx.refresh();
      if (isDiskFullError(err)) {
        ctx.transition({ status: "blocked_disk", nextRunAt: now() + 60_000, errorCode: "DISK_FULL", errorMessage: "Disk is full", message: "paused: disk full" });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (job.attempt < job.max_attempts) {
        ctx.transition({ status: "retry_wait", stage: "normalizing", attempt: job.attempt + 1, nextRunAt: now() + 2_000, errorCode: "COMPOSE_FAILED", errorMessage: message.slice(0, 1000), message: "compose failed — retrying with safe fallback (simple crossfades, no ducking)" });
        return;
      }
      tx(() => {
        ctx.transition({ status: "failed", errorCode: "COMPOSE_FAILED", errorMessage: message.slice(0, 1000), message: "compose failed" });
        db().prepare("UPDATE ad_versions SET status = 'failed', error_code = 'COMPOSE_FAILED', error_message = ?, updated_at = ? WHERE id = ?").run(message.slice(0, 500), now(), versionId);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

async function compose(ctx: JobContext, versionId: string, dir: string): Promise<void> {
  const v = requireVersion(versionId);
  const settings = settingsOf(v);
  const finishing = finishingOf(v);
  const brief = getBrief(versionId);
  const brand = getMasterBrand()!;
  const frame = frameFor(v.platform);
  const { width: W, height: H } = frame;
  const rows = getScenes(versionId);
  const scenes = draftScenes(versionId);
  const fallback = ctx.job.attempt > 1;
  const lang = finishing.outroLang;
  const signal = ctx.signal;

  // 1. Normalize clips (cached by source hash + profile).
  if (ctx.job.stage !== "normalizing") ctx.transition({ stage: "normalizing", message: "restarting compose from normalize" });
  const clips: string[] = [];
  for (const [i, row] of rows.entries()) {
    const asset = getAsset(row.clip_asset_id ?? "");
    if (!asset) throw new AppError("CLIP_MISSING", `Scene ${i + 1} has no clip`, 500);
    if (row.scene_type === "product_original") {
      clips.push(absolutePath(asset));
      continue;
    }
    const keepAudio = settings.clipAudio;
    const key = sha256(`${asset.sha256}|${W}x${H}|${row.duration_s}|${keepAudio}|v1`);
    const cached = path.join(paths.cache, `norm-${key}.mp4`);
    if (!existsSync(cached)) {
      const info = await probe(absolutePath(asset));
      const tmp = path.join(dir, `norm-${i}.mp4`);
      await normalizeClip(absolutePath(asset), tmp, { width: W, height: H, durationS: row.duration_s, keepAudio, sourceHasAudio: !!info.audio }, { signal });
      await rename(tmp, cached);
    }
    clips.push(cached);
  }

  // 2. Brand graphics: overlays + outro (official logo, tokens only).
  ctx.transition({ stage: "rendering_overlays", message: "rendering brand overlays and outro" });
  const timeline = timelineFor(scenes, v.pacing);
  const overlays: { file: string; startS: number; endS: number; motion: "fade-up" | "slide-in" | "scale-in" | "logo-reveal"; words: number; scene: number }[] = [];
  for (const [i, s] of scenes.entries()) {
    const lines = s.overlay.byLang[lang] ?? [];
    if (!lines.length) continue;
    const file = path.join(dir, `overlay-${i}.png`);
    await renderOverlay({ brand, platform: v.platform, lang, layout: s.overlay.layout, lines, outFile: file });
    const seg = timeline.segments[i]!;
    const incoming = i > 0 ? timeline.segments[i - 1]!.transitionOutS : 0;
    overlays.push({ file, startS: seg.startS + incoming + 0.1, endS: seg.endS - seg.transitionOutS - 0.05, motion: s.overlay.motion, words: readingWords(lines), scene: i });
  }
  const ctaText = brief.cta[lang] ?? "";
  const offer = offerLine(brief.offers);
  const offerLines = [
    ...groupBuyLines(brief),
    ...(offer?.price && !brief.offers.groupBuy ? [{ kind: "offer_price" as const, text: offer.price }, ...(offer.mrp ? [{ kind: "offer_mrp" as const, text: offer.mrp }] : []), ...(offer.discount ? [{ kind: "offer_discount" as const, text: offer.discount }] : []), ...(offer.validUntil ? [{ kind: "offer_validity" as const, text: offer.validUntil }] : [])] : []),
  ];
  const productId = brief.product.imageAssetIds[0];
  const outroPng = await renderOutro({
    brand,
    platform: v.platform,
    lang,
    type: finishing.outroType,
    cta: ctaText,
    offerLines,
    product: productId ? { assetId: productId, name: brief.product.name, price: brief.offers.priceInr ? formatInr(brief.offers.priceInr) : null } : undefined,
    outFile: path.join(dir, "outro.png"),
  });
  const outroFile = path.join(dir, "outro.mp4");
  await outroClip(outroPng.file, outroFile, { width: W, height: H, durationS: OUTRO_S }, { signal });

  // 3. Encode.
  ctx.transition({ stage: "encoding", message: fallback ? "encoding (fallback: simple crossfades, no ducking)" : "encoding final video", progress: 0 });
  const music = finishing.musicAssetId ? getAsset(finishing.musicAssetId) : undefined;
  const hasMusic = !!music && finishing.audioMode !== "clip_only";
  const audioMode = !music ? "clip_only" : fallback && finishing.audioMode === "mix" ? "music_only" : finishing.audioMode;
  // Fallback keeps the planned timeline (exact length) but uses plain crossfades and no ducking.
  const transitions: XfadeKind[] = scenes.map((s, i) => (i === scenes.length - 1 || fallback ? (s.creative.transitionOut === "cut" && i < scenes.length - 1 ? "cut" : "crossfade") : s.creative.transitionOut));
  const tl = timeline;
  const g = buildComposeGraph({
    timeline: tl,
    transitions,
    overlays: overlays.map((o) => ({ startS: o.startS, endS: o.endS, motion: o.motion })),
    width: W,
    height: H,
    audioMode,
    hasMusic,
    musicVolumeDb: finishing.musicVolumeDb,
  });
  const out = path.join(dir, "final.mp4");
  let lastPct = 0;
  await ffmpeg(
    [
      "-y",
      ...clips.flatMap((c) => ["-i", c]),
      "-i", outroFile,
      ...overlays.flatMap((o) => ["-loop", "1", "-framerate", "30", "-t", String(tl.totalS), "-i", o.file]),
      ...(hasMusic ? ["-stream_loop", "-1", "-i", absolutePath(music!)] : []),
      "-filter_complex", g.filter, "-map", g.videoOut, "-map", g.audioOut,
      "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", String(tl.totalS), "-movflags", "+faststart",
      "-progress", "pipe:1", out,
    ],
    {
      signal,
      onProgress: (s) => {
        const pct = Math.min(0.99, s / tl.totalS);
        if (pct - lastPct >= 0.1) {
          lastPct = pct;
          ctx.transition({ progress: Math.round(pct * 100) / 100, message: `encoding ${Math.round(pct * 100)}%` });
        }
      },
    },
  );

  // 4. Technical validation (plan §6).
  ctx.transition({ stage: "validating", message: "validating final video", progress: 1 });
  const expectSound = hasMusic || settings.clipAudio;
  const tech = await validateFinal(out, { width: W, height: H, durationS: tl.totalS }, { expectSound }, { signal });
  if (!tech.ok) throw new AppError("FINAL_INVALID", tech.checks.filter((c) => c.status === "fail").map((c) => `${c.key}: ${c.message}`).join("; "), 500);

  // 5. Finalize: store, thumbnail, QA reports, ready.
  ctx.transition({ stage: "finalizing", message: "saving and running QA" });
  const final = await putFile(out, {
    kind: "video",
    mime: "video/mp4",
    ext: "mp4",
    source: "composed",
    width: W,
    height: H,
    durationS: tech.info?.durationS ?? tl.totalS,
    originalName: `demandmesh_${brief.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}_${v.platform}_${W}x${H}_v${v.number}.mp4`,
    provenance: { sourceType: "rendered", origin: `PINPO compose of version ${versionId}`, license: "Proprietary – DemandMesh", commercialUse: "yes", rightsHolder: "DemandMesh" },
  });
  const thumbFile = path.join(dir, "thumb.jpg");
  await thumbnail(absolutePath(final), Math.min(1.5, tl.totalS / 3), thumbFile);
  const thumb = await putFile(thumbFile, { kind: "image", mime: "image/jpeg", ext: "jpg", source: "derived", width: 480, provenance: { sourceType: "rendered", commercialUse: "yes", license: "Proprietary – DemandMesh" } });

  const technicalItems: QaItem[] = tech.checks.map((c) => ({ check: `technical_${c.key}`, method: "automated", status: c.status, message: c.message, evidence: c.value }));
  const creative = await creativeItems({ v, scenes, rows, brief, brand, lang, overlays, timeline: tl, music, dir, ctaText, settingsModel: settings.modelId, outroType: finishing.outroType });

  tx(() => {
    writeReport(versionId, "technical", technicalItems);
    writeReport(versionId, "creative", creative);
    db().prepare("UPDATE ad_versions SET status = 'ready', final_asset_id = ?, thumb_asset_id = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?").run(final.id, thumb.id, now(), versionId);
    db().prepare("UPDATE ads SET updated_at = ? WHERE id = ?").run(now(), v.ad_id);
    refreshQaStatus(versionId);
    ctx.transition({ status: "succeeded", stage: "done", message: "final video ready", resultJson: { finalAssetId: final.id, durationS: tech.info?.durationS } });
  });
}

/** Creative & brand QA (plan §9): automated checks, heuristic hook assessment, human review items. */
async function creativeItems(a: {
  v: ReturnType<typeof requireVersion>;
  scenes: ReturnType<typeof draftScenes>;
  rows: ReturnType<typeof getScenes>;
  brief: ReturnType<typeof getBrief>;
  brand: NonNullable<ReturnType<typeof getMasterBrand>>;
  lang: "en" | "ml" | "hi";
  overlays: { startS: number; endS: number; words: number; scene: number }[];
  timeline: ReturnType<typeof timelineFor>;
  music: ReturnType<typeof getAsset>;
  dir: string;
  ctaText: string;
  settingsModel: string;
  outroType: "standard" | "promotional" | "product" | "minimal";
}): Promise<QaItem[]> {
  const items: QaItem[] = [];
  const { brand, v } = a;
  const frame = frameFor(v.platform);

  // Logo accuracy: pinned hash verified at render; low-res temporary logo is a warning.
  const logo = officialLogo(brand);
  const logoRec = brand.logos.find((l) => l.variant === "horizontal")!;
  items.push({ check: "logo_accuracy", method: "automated", status: "pass", message: `Official logo used (sha256 ${logo.asset.sha256.slice(0, 12)}…, pinned).` });
  if (logoRec.temporary || logo.width * logo.maxScale < safeBox(frame).width * 0.45) {
    items.push({ check: "logo_accuracy", method: "automated", status: "warn", message: `Logo is the temporary ${logo.width}×${logo.height} file — it can't be shown larger than ${Math.round(logo.width * logo.maxScale)} px. Replace it with the official high-res logo.` });
  }

  // Brand colours: all brand-layer colours come from tokens (enforced at render).
  const colors = brandColors(brand);
  items.push({ check: "brand_color_compliance", method: "automated", status: "pass", message: `Overlays, CTA and outro use only DemandMesh tokens (${Object.values(colors).slice(0, 4).join(", ")}…).` });

  // Text readability: solid token panels → computed contrast; minimum size; reading time.
  const contrast = contrastRatio(colors.primary, colors.white);
  const readingIssues = a.overlays.filter((o) => o.endS - o.startS < o.words / 2.5 + 0.5).map((o) => `scene ${o.scene + 1} shows ${o.words} words for ${(o.endS - o.startS).toFixed(1)}s`);
  items.push({
    check: "text_readability",
    method: "automated",
    status: readingIssues.length ? "warn" : contrast >= 4.5 ? "pass" : "fail",
    message: readingIssues.length ? `Short reading time: ${readingIssues.join("; ")}. Lengthen the scene or shorten the text.` : `Text sits on solid brand panels (contrast ${contrast.toFixed(1)}:1); sizes ≥ 2.4% of frame height; reading time OK.`,
  });

  // Platform-safe placement: the layout engine only places text/logo inside the safe area.
  const p = PLATFORMS[v.platform];
  items.push({ check: "platform_safe_placement", method: "automated", status: "pass", message: `All text and logos are inside the ${p.label} safe area (top ${Math.round(p.safe.top * 100)}%, bottom ${Math.round(p.safe.bottom * 100)}%, sides ${Math.round(p.safe.left * 100)}%).` });

  // Hook (heuristic creative assessment, not a verdict).
  const first = a.scenes[0]!;
  const hookOverlay = a.overlays.find((o) => o.scene === 0);
  const productBy3s = a.scenes.some((s, i) => (s.showsProduct || s.overlay.byLang[a.lang]?.some((l) => l.kind.startsWith("offer_"))) && a.timeline.segments[i]!.startS <= 3);
  const hookOk = !!hookOverlay && hookOverlay.startS <= 2 && productBy3s && first.durationS >= 1.5;
  items.push({
    check: "hook_effectiveness",
    method: "heuristic",
    status: hookOk ? "pass" : "warn",
    message: hookOk ? "Creative assessment: opening has motion and a hook line in the first 2s, and the product appears by 3s." : "Creative assessment: the opening may not hook — show the product or offer and a hook line within the first 2–3 seconds.",
  });

  // CTA presence + end card.
  items.push({ check: "cta_presence", method: "automated", status: a.ctaText ? "pass" : "fail", message: a.ctaText ? `CTA "${a.ctaText}" in the outro.` : "No call to action." });
  const outroOk = brand.tokens.website === "demandmesh.shop" && OUTRO_S >= 2.5 && OUTRO_S <= 4;
  const outroName = { standard: "Standard", promotional: "Promotional", product: "Product-specific", minimal: "Minimal logo" }[a.outroType];
  items.push({ check: "end_card_correctness", method: "automated", status: outroOk ? "pass" : "fail", message: `${outroName} DemandMesh outro: official logo, "demandmesh.shop", ${OUTRO_S}s.` });
  const hasOffer = !!a.brief.offers.priceInr || !!a.brief.offers.groupBuy;
  if ((a.brief.campaign.objective === "sales" || a.brief.campaign.objective === "group_buy") && hasOffer && a.outroType === "minimal") {
    items.push({ check: "end_card_correctness", method: "heuristic", status: "warn", message: "This is a sales ad with an offer, but the outro is the minimal logo version — the Promotional outro would repeat the offer." });
  }

  // Product appearance consistency.
  const model = getModel(a.settingsModel);
  for (const [i, row] of a.rows.entries()) {
    const s = a.scenes[i]!;
    if (!s.showsProduct) continue;
    if (row.scene_type === "product_original" && s.productAssetId) {
      const product = getAsset(s.productAssetId)!;
      const clip = absolutePath(getAsset(row.clip_asset_id!)!);
      const zoom = s.creative.productMotion === "push-in" || s.creative.productMotion === "rotate-in" ? PUSH_IN_ZOOM : null;
      if (zoom) {
        const r = await compareProductRegion({ clip, holdS: s.durationS * 0.95, frame, productFile: absolutePath(product), productSize: { width: product.width!, height: product.height! }, canvasScale: PRODUCT_CANVAS_SCALE, zoomAtHold: zoom, workDir: a.dir });
        const ok = r.meanDeltaE <= PRODUCT_THRESHOLDS.meanDeltaE && r.p95DeltaE <= PRODUCT_THRESHOLDS.p95DeltaE && r.ssim >= PRODUCT_THRESHOLDS.ssim && r.aspectError <= PRODUCT_THRESHOLDS.aspectError;
        items.push({
          check: "product_appearance",
          method: "automated",
          status: ok ? "pass" : "fail",
          message: `Scene ${i + 1} (original photo): mean ΔE ${r.meanDeltaE.toFixed(2)}, P95 ΔE ${r.p95DeltaE.toFixed(2)}, SSIM ${r.ssim.toFixed(3)}, aspect error ${(r.aspectError * 100).toFixed(2)}%.`,
          evidence: r,
        });
      } else {
        items.push({ check: "product_appearance", method: "automated", status: "pass", message: `Scene ${i + 1} uses the original photo (${s.creative.productMotion}; uniform scale only, aspect preserved).` });
      }
    } else {
      items.push({ check: "product_appearance", method: "human", status: "needs_review", message: `Scene ${i + 1} is AI-generated from the product photo (${model.label}). Check the packaging text, shape and colour match the real product before export.` });
    }
  }

  // Compliance over the actual on-screen text.
  items.push(...complianceItems({ brief: a.brief, scenes: a.scenes, outroCta: { lang: a.lang, text: a.ctaText }, today: indiaToday(), approvedCtas: brand.tokens.approvedCtas, brandLines: brandLines() }));

  // Rights (basic gate; full provenance checks come with Phase 7).
  const used = [...a.rows.map((r) => getAsset(r.clip_asset_id ?? "")), ...a.scenes.map((s) => (s.productAssetId ? getAsset(s.productAssetId) : undefined)), a.music].filter((x): x is NonNullable<typeof x> => !!x);
  const bad = used.filter((u) => u.commercial_use === "no");
  const unknown = used.filter((u) => u.commercial_use === "unknown");
  items.push({
    check: "asset_rights",
    method: "automated",
    status: bad.length ? "fail" : unknown.length ? "needs_review" : "pass",
    message: bad.length ? `${bad.length} asset(s) can't be used commercially.` : unknown.length ? `${unknown.length} asset(s) have unknown commercial-use rights — confirm before export.` : "All assets used have commercial-use permission.",
  });
  return items;
}

/** Words a viewer must read; a price block (price/MRP/discount) counts as a 2-word glance. */
function readingWords(lines: { kind: string; text: string }[]): number {
  const text = lines.filter((l) => !l.kind.startsWith("offer_") && !l.kind.startsWith("group_")).map((l) => l.text).join(" ");
  const offer = (lines.some((l) => l.kind === "offer_price") ? 2 : 0) + (lines.some((l) => l.kind === "group_price") ? 5 : 0);
  return (text.trim() ? text.trim().split(/\s+/).length : 0) + offer;
}

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}
