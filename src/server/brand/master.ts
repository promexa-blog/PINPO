import "../guard";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, tx } from "../db";
import { paths } from "../paths";
import { putFile } from "../storage/assets";
import { FONTS, fontFile } from "../render/fonts";
import { newId, now, sha256, AppError } from "../util";

export interface BrandTokens {
  name: string;
  website: string;
  tagline: string;
  social: Record<string, string>;
  colors: Record<string, string>;
  typography: Record<string, unknown>;
  spacing: Record<string, unknown>;
  cta: Record<string, unknown>;
  motion: Record<string, unknown>;
  logo: Record<string, { file: string; sha256: string; origin?: string; temporary?: boolean; maxScale?: number }>;
  approvedCtas: Record<string, string[]>;
}

const BRAND_DIR = () => path.join(paths.bundled.brand, "demandmesh");

export function readBundledTokens(): BrandTokens {
  return JSON.parse(readFileSync(path.join(BRAND_DIR(), "brand.json"), "utf8")) as BrandTokens;
}

export interface MasterBrand {
  id: string;
  name: string;
  locked: boolean;
  revisionId: string;
  revisionNumber: number;
  tokens: BrandTokens;
  logos: { variant: string; assetId: string; pinnedSha256: string; width: number | null; height: number | null; temporary: boolean }[];
}

export function getMasterBrand(): MasterBrand | undefined {
  const kit = db().prepare("SELECT * FROM brand_kits WHERE is_master = 1").get() as
    | { id: string; name: string; locked: number; current_revision_id: string }
    | undefined;
  if (!kit) return undefined;
  const rev = db().prepare("SELECT * FROM brand_kit_revisions WHERE id = ?").get(kit.current_revision_id) as { id: string; number: number; tokens_json: string };
  const logos = db()
    .prepare(
      `SELECT l.variant, l.asset_id, l.pinned_sha256, a.width, a.height, a.temporary
       FROM brand_kit_logos l JOIN assets a ON a.id = l.asset_id WHERE l.brand_kit_id = ?`,
    )
    .all(kit.id) as { variant: string; asset_id: string; pinned_sha256: string; width: number | null; height: number | null; temporary: number }[];
  return {
    id: kit.id,
    name: kit.name,
    locked: kit.locked === 1,
    revisionId: rev.id,
    revisionNumber: rev.number,
    tokens: JSON.parse(rev.tokens_json) as BrandTokens,
    logos: logos.map((l) => ({ variant: l.variant, assetId: l.asset_id, pinnedSha256: l.pinned_sha256, width: l.width, height: l.height, temporary: l.temporary === 1 })),
  };
}

/**
 * Seeds the protected DemandMesh master brand on first run (plan §3): imports the official logo
 * (verifying its pinned hash), records fonts as OFL assets, and creates revision 1. Idempotent.
 */
export async function seedMasterBrand(): Promise<MasterBrand> {
  const existing = getMasterBrand();
  if (existing) return existing;
  const tokens = readBundledTokens();

  const logoSpec = tokens.logo.horizontal;
  if (!logoSpec) throw new AppError("BRAND_LOGO_MISSING", "brand.json has no horizontal logo", 500);
  const logoPath = path.join(BRAND_DIR(), logoSpec.file);
  const bytes = readFileSync(logoPath);
  if (sha256(bytes) !== logoSpec.sha256) {
    throw new AppError("LOGO_HASH_MISMATCH", "Official logo file does not match its pinned sha256 — refusing to seed", 500);
  }
  const meta = await sharp(bytes).metadata();
  const logo = await putFile(logoPath, {
    kind: "image",
    mime: "image/png",
    ext: "png",
    source: "seed",
    keepSource: true,
    official: true,
    temporary: !!logoSpec.temporary,
    width: meta.width ?? null,
    height: meta.height ?? null,
    originalName: logoSpec.file,
    provenance: {
      sourceType: "official_brand",
      origin: logoSpec.origin ?? "bundled",
      license: "Proprietary – DemandMesh",
      commercialUse: "yes",
      rightsHolder: "DemandMesh",
    },
  });

  for (const face of Object.values(FONTS)) {
    await putFile(fontFile(face), {
      kind: "font",
      mime: "font/ttf",
      ext: "ttf",
      source: "seed",
      keepSource: true,
      originalName: face.file,
      provenance: { sourceType: "font", origin: "github.com/google/fonts", license: "SIL Open Font License 1.1", commercialUse: "yes", rightsHolder: "Google / Noto authors" },
    });
  }

  tx(() => {
    if (db().prepare("SELECT 1 FROM brand_kits WHERE is_master = 1").get()) return;
    const t = now();
    const kitId = newId("brd");
    const revId = newId("brv");
    db().prepare("INSERT INTO brand_kits (id, name, is_master, locked, current_revision_id, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?, ?)").run(kitId, tokens.name, revId, t, t);
    db().prepare("INSERT INTO brand_kit_revisions (id, brand_kit_id, number, tokens_json, note, created_at) VALUES (?, ?, 1, ?, ?, ?)").run(revId, kitId, JSON.stringify(tokens), "Initial DemandMesh master brand", t);
    db().prepare("INSERT INTO brand_kit_logos (brand_kit_id, variant, asset_id, pinned_sha256) VALUES (?, 'horizontal', ?, ?)").run(kitId, logo.id, logoSpec.sha256);
  });
  return getMasterBrand()!;
}

/** Plan §3: the master brand can't be deleted; edits need an explicit unlock (implemented in Phase 8). */
export function assertBrandEditable(brandKitId: string): void {
  const kit = db().prepare("SELECT is_master, locked FROM brand_kits WHERE id = ?").get(brandKitId) as { is_master: number; locked: number } | undefined;
  if (!kit) throw new AppError("NOT_FOUND", "Brand kit not found", 404);
  if (kit.locked) throw new AppError("BRAND_LOCKED", "Brand settings are locked. Unlock them first.", 423);
}

export function assertBrandDeletable(brandKitId: string): void {
  const kit = db().prepare("SELECT is_master FROM brand_kits WHERE id = ?").get(brandKitId) as { is_master: number } | undefined;
  if (!kit) throw new AppError("NOT_FOUND", "Brand kit not found", 404);
  if (kit.is_master) throw new AppError("BRAND_PROTECTED", "The DemandMesh master brand can't be deleted.", 409);
}
