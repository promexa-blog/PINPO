import "../guard";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { paths } from "../paths";
import { newId, now, AppError } from "../util";

export type AssetKind = "image" | "audio" | "video" | "font" | "document";
export type AssetSource = "upload" | "generated" | "composed" | "derived" | "seed" | "rendered";
export type CommercialUse = "yes" | "no" | "unknown";
export type SourceType =
  | "official_brand"
  | "product_supplier"
  | "own_photo"
  | "stock_licensed"
  | "commissioned"
  | "recorded_voice"
  | "generated_fal"
  | "rendered"
  | "font";

export interface Provenance {
  sourceType: SourceType;
  origin?: string | null;
  license?: string | null;
  commercialUse: CommercialUse;
  attributionText?: string | null;
  rightsHolder?: string | null;
  licenseExpiresAt?: number | null;
  talentConsent?: boolean;
  proofNote?: string | null;
}

export interface AssetRow {
  id: string;
  sha256: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  path: string;
  source: AssetSource;
  original_name: string | null;
  official: number;
  temporary: number;
  source_type: SourceType | null;
  origin: string | null;
  license: string | null;
  commercial_use: CommercialUse;
  attribution_text: string | null;
  rights_holder: string | null;
  license_expires_at: number | null;
  talent_consent: number;
  proof_note: string | null;
  icc_profile: string | null;
  created_at: number;
}

export interface PutOptions {
  kind: AssetKind;
  mime: string;
  ext: string;
  source: AssetSource;
  provenance?: Provenance;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  originalName?: string | null;
  official?: boolean;
  temporary?: boolean;
  iccProfile?: string | null;
}

const EXT_RE = /^[a-z0-9]{1,5}$/;

/** storage/assets/ab/<sha256>.<ext> — content addressed, never user-controlled. */
export function assetPath(sha: string, ext: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha) || !EXT_RE.test(ext)) throw new AppError("BAD_ASSET_PATH", "Invalid asset hash/extension", 500);
  return path.join(paths.assets, sha.slice(0, 2), `${sha}.${ext}`);
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Moves (or copies) a finished temp file into content-addressed storage atomically and registers it.
 * Identical bytes dedupe to the same asset; provenance passed again updates the existing row.
 */
export async function putFile(tempFile: string, opts: PutOptions & { keepSource?: boolean }): Promise<AssetRow> {
  if (!EXT_RE.test(opts.ext)) throw new AppError("BAD_EXT", "Invalid file extension");
  const sha = await hashFile(tempFile);
  const { size } = await stat(tempFile);
  const existing = getAssetBySha(sha);
  if (existing) {
    if (!opts.keepSource) await rm(tempFile, { force: true });
    if (opts.provenance) updateProvenance(existing.id, opts.provenance);
    return getAsset(existing.id)!;
  }
  const dest = assetPath(sha, opts.ext);
  await mkdir(path.dirname(dest), { recursive: true });
  const staging = `${dest}.${process.pid}.tmp`;
  if (opts.keepSource) await copyFile(tempFile, staging);
  else {
    try {
      await rename(tempFile, staging);
    } catch {
      await copyFile(tempFile, staging);
      await rm(tempFile, { force: true });
    }
  }
  await rename(staging, dest);
  const id = newId("ast");
  const p = opts.provenance;
  db()
    .prepare(
      `INSERT INTO assets (id, sha256, kind, mime, bytes, width, height, duration_s, path, source, original_name, official, temporary,
        source_type, origin, license, commercial_use, attribution_text, rights_holder, license_expires_at, talent_consent, proof_note, icc_profile, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(sha256) DO NOTHING`,
    )
    .run(
      id, sha, opts.kind, opts.mime, size, opts.width ?? null, opts.height ?? null, opts.durationS ?? null,
      path.relative(paths.storage, dest), opts.source, opts.originalName ?? null, opts.official ? 1 : 0, opts.temporary ? 1 : 0,
      p?.sourceType ?? null, p?.origin ?? null, p?.license ?? null, p?.commercialUse ?? "unknown", p?.attributionText ?? null,
      p?.rightsHolder ?? null, p?.licenseExpiresAt ?? null, p?.talentConsent ? 1 : 0, p?.proofNote ?? null, opts.iccProfile ?? null, now(),
    );
  return getAssetBySha(sha)!;
}

export async function putBuffer(buf: Buffer, opts: PutOptions): Promise<AssetRow> {
  await mkdir(paths.work, { recursive: true });
  const tmp = path.join(paths.work, `put-${newId("tmp")}.${opts.ext}`);
  await writeFile(tmp, buf);
  return putFile(tmp, opts);
}

export function getAsset(id: string): AssetRow | undefined {
  return db().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
}

export function getAssetBySha(sha: string): AssetRow | undefined {
  return db().prepare("SELECT * FROM assets WHERE sha256 = ?").get(sha) as AssetRow | undefined;
}

/** Absolute path of an asset's file. The stored path is always relative to storage/ and validated. */
export function absolutePath(asset: Pick<AssetRow, "path">): string {
  const abs = path.resolve(paths.storage, asset.path);
  if (!abs.startsWith(paths.assets + path.sep)) throw new AppError("BAD_ASSET_PATH", "Asset path escapes storage", 500);
  return abs;
}

export function updateProvenance(id: string, p: Provenance): void {
  db()
    .prepare(
      `UPDATE assets SET source_type = ?, origin = ?, license = ?, commercial_use = ?, attribution_text = ?, rights_holder = ?,
        license_expires_at = ?, talent_consent = ?, proof_note = ? WHERE id = ?`,
    )
    .run(
      p.sourceType, p.origin ?? null, p.license ?? null, p.commercialUse, p.attributionText ?? null, p.rightsHolder ?? null,
      p.licenseExpiresAt ?? null, p.talentConsent ? 1 : 0, p.proofNote ?? null, id,
    );
}
