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
  groupBuyLine?: string;
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

// ---------------- protected editing (plan §3) ----------------

/** Unlock window: edits are accepted only shortly after an explicit unlock. */
const UNLOCK_MS = 10 * 60_000;

export function unlockBrand(brandKitId: string): { unlockedUntil: number } {
  const until = now() + UNLOCK_MS;
  const r = db().prepare("UPDATE brand_kits SET locked = 0, updated_at = ? WHERE id = ?").run(now(), brandKitId);
  if (r.changes !== 1) throw new AppError("NOT_FOUND", "Brand kit not found", 404);
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`brand_unlock:${brandKitId}`, String(until));
  return { unlockedUntil: until };
}

/** Copy fields DemandMesh may change. Colours, logo files and website are identity — not editable here. */
export interface BrandCopyPatch {
  tagline?: string;
  groupBuyLine?: string;
  approvedCtas?: Record<"en" | "ml" | "hi", string[]>;
  social?: Record<string, string>;
  note?: string;
}

export function updateBrandCopy(brandKitId: string, patch: BrandCopyPatch): MasterBrand {
  return tx(() => {
    const kit = db().prepare("SELECT locked FROM brand_kits WHERE id = ?").get(brandKitId) as { locked: number } | undefined;
    if (!kit) throw new AppError("NOT_FOUND", "Brand kit not found", 404);
    const until = Number((db().prepare("SELECT value FROM settings WHERE key = ?").get(`brand_unlock:${brandKitId}`) as { value: string } | undefined)?.value ?? 0);
    if (kit.locked || until < now()) {
      db().prepare("UPDATE brand_kits SET locked = 1 WHERE id = ?").run(brandKitId);
      throw new AppError("BRAND_LOCKED", "Brand settings are locked. Unlock them first.", 423);
    }
    const current = getMasterBrand();
    if (!current || current.id !== brandKitId) throw new AppError("NOT_FOUND", "Brand kit not found", 404);
    const tokens: BrandTokens = {
      ...current.tokens,
      ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
      ...(patch.groupBuyLine !== undefined ? { groupBuyLine: patch.groupBuyLine } : {}),
      ...(patch.approvedCtas ? { approvedCtas: patch.approvedCtas } : {}),
      ...(patch.social ? { social: patch.social } : {}),
    };
    const number = current.revisionNumber + 1;
    const revId = newId("brv");
    db().prepare("INSERT INTO brand_kit_revisions (id, brand_kit_id, number, tokens_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(revId, brandKitId, number, JSON.stringify(tokens), patch.note ?? null, now());
    // Saving re-locks. Existing versions keep the revision they were made with.
    db().prepare("UPDATE brand_kits SET current_revision_id = ?, locked = 1, updated_at = ? WHERE id = ?").run(revId, now(), brandKitId);
    db().prepare("DELETE FROM settings WHERE key = ?").run(`brand_unlock:${brandKitId}`);
    return getMasterBrand()!;
  });
}

export function brandRevisions(brandKitId: string) {
  return db().prepare("SELECT id, number, note, created_at FROM brand_kit_revisions WHERE brand_kit_id = ? ORDER BY number DESC").all(brandKitId) as { id: string; number: number; note: string | null; created_at: number }[];
}
