import "../guard";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { UPLOAD_LIMITS, type UploadMeta } from "@/lib/schemas";
import { sniff } from "../security/sniff";
import { probe } from "../media/probe";
import { paths } from "../paths";
import { putBuffer, putFile, type AssetRow, type Provenance } from "./assets";
import { newId, AppError } from "../util";

function toProvenance(meta: UploadMeta): Provenance {
  const p = meta.provenance;
  return {
    sourceType: p.sourceType,
    origin: p.origin,
    license: p.license ?? (meta.purpose === "product_image" ? (p.sourceType === "own_photo" ? "Own photo" : "Supplier permission") : null),
    commercialUse: (meta.purpose === "product_image" || meta.purpose === "brand_logo") && p.permissionConfirmed ? "yes" : p.commercialUse,
    attributionText: p.attributionText,
    rightsHolder: p.rightsHolder,
    licenseExpiresAt: p.licenseExpiresAt,
    talentConsent: p.talentConsent,
    proofNote: p.proofNote,
  };
}

/**
 * Validates and stores an upload (plan §9 + §7 [v2.2]):
 * - type from magic bytes only (no SVG/HTML), size limits;
 * - images decoded + auto-oriented + converted to sRGB via their ICC profile, metadata stripped,
 *   re-encoded losslessly as PNG (never stretched or resized);
 * - audio verified by ffprobe (duration limit).
 */
export async function storeUpload(buf: Buffer, originalName: string, meta: UploadMeta): Promise<AssetRow> {
  const type = sniff(buf);
  const wantsImage = meta.purpose === "product_image" || meta.purpose === "frame_image" || meta.purpose === "brand_logo";
  if (!type) throw new AppError("UNSUPPORTED_TYPE", "Unsupported file type. Use JPG, PNG or WebP images, or MP3, WAV or M4A audio.", 415);
  if (wantsImage && type.kind !== "image") throw new AppError("UNSUPPORTED_TYPE", "This slot needs a JPG, PNG or WebP image.", 415);
  if (!wantsImage && type.kind !== "audio") throw new AppError("UNSUPPORTED_TYPE", "This slot needs an MP3, WAV or M4A audio file.", 415);
  const name = path.basename(originalName).slice(0, 200);

  if (type.kind === "image") {
    if (buf.length > UPLOAD_LIMITS.imageMaxBytes) throw new AppError("FILE_TOO_LARGE", "Images must be 10 MB or smaller.", 413);
    let meta0: Metadata;
    try {
      meta0 = await sharp(buf, { limitInputPixels: UPLOAD_LIMITS.imageMaxPixels }).metadata();
    } catch {
      throw new AppError("IMAGE_UNREADABLE", "This image can't be read. Try exporting it again as PNG or JPG.", 400);
    }
    const w = meta0.autoOrient?.width ?? meta0.width ?? 0;
    const h = meta0.autoOrient?.height ?? meta0.height ?? 0;
    if (meta.purpose === "brand_logo") {
      if (Math.max(w, h) < UPLOAD_LIMITS.logoMinLongSide || Math.min(w, h) < UPLOAD_LIMITS.logoMinShortSide)
        throw new AppError("IMAGE_TOO_SMALL", `Logos must be at least ${UPLOAD_LIMITS.logoMinLongSide} px on the long side (this one is ${w}×${h}).`, 400);
    } else if (Math.min(w, h) < UPLOAD_LIMITS.imageMinSide) {
      throw new AppError("IMAGE_TOO_SMALL", `Images must be at least ${UPLOAD_LIMITS.imageMinSide}×${UPLOAD_LIMITS.imageMinSide} px (this one is ${w}×${h}).`, 400);
    }
    const iccProfile = meta0.icc ? `embedded (${meta0.space ?? "unknown"})` : `none (${meta0.space ?? "srgb"})`;
    const { data, info } = await sharp(buf, { limitInputPixels: UPLOAD_LIMITS.imageMaxPixels })
      .rotate()
      .toColourspace("srgb")
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return putBuffer(data, {
      kind: "image",
      mime: "image/png",
      ext: "png",
      source: "upload",
      width: info.width,
      height: info.height,
      originalName: name,
      iccProfile,
      provenance: toProvenance(meta),
    });
  }

  if (buf.length > UPLOAD_LIMITS.audioMaxBytes) throw new AppError("FILE_TOO_LARGE", "Audio files must be 20 MB or smaller.", 413);
  await mkdir(paths.work, { recursive: true });
  const tmp = path.join(paths.work, `upload-${newId("u")}.${type.ext}`);
  await writeFile(tmp, buf);
  const info = await probe(tmp);
  if (!info.audio || info.video) throw new AppError("AUDIO_UNREADABLE", "This file has no readable audio track.", 400);
  if (info.durationS <= 0 || info.durationS > UPLOAD_LIMITS.audioMaxSeconds) {
    throw new AppError("AUDIO_TOO_LONG", "Audio must be between 0 and 10 minutes long.", 400);
  }
  return putFile(tmp, {
    kind: "audio",
    mime: type.mime,
    ext: type.ext,
    source: "upload",
    durationS: info.durationS,
    originalName: name,
    provenance: toProvenance(meta),
  });
}
