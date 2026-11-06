import "../guard";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, tx } from "../db";
import { paths } from "../paths";
import { getAsset, putFile } from "../storage/assets";
import { FONTS, fontFile } from "../render/fonts";
import { derivePalette } from "@/lib/color";
import type { BrandCreate, BrandPatch, BrandSummary } from "@/lib/brand";
import { newId, now, sha256, AppError } from "../util";

/**
 * Brand kits (plan §3, generalised in v3). Any number of brands; one is the default for new ads.
 * Every saved edit is a new revision, and each ad version keeps the revision it was made with, so
 * changing a brand never changes ads already made.
 */

export interface LogoSpec {
  /** Bundled seed file (DemandMesh) — resolved through brand_kit_logos. */
  file?: string;
  /** Uploaded logo pinned in this revision. */
  assetId?: string;
  sha256: string;
  origin?: string;
  temporary?: boolean;
  maxScale?: number;
}

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
  logo: Partial<Record<"horizontal", LogoSpec>>;
  approvedCtas: Record<string, string[]>;
  groupBuyLine?: string;
}

export interface BrandLogo {
  variant: string;
  assetId: string;
  pinnedSha256: string;
  width: number | null;
  height: number | null;
  temporary: boolean;
}

export interface Brand {
  id: string;
  name: string;
  isDefault: boolean;
  locked: boolean;
  revisionId: string;
  revisionNumber: number;
  tokens: BrandTokens;
  /** Empty when the brand uses a text wordmark. */
  logos: BrandLogo[];
}

const SEED_DIR = () => path.join(paths.bundled.brand, "demandmesh");

export function readBundledTokens(): BrandTokens {
  return JSON.parse(readFileSync(path.join(SEED_DIR(), "brand.json"), "utf8")) as BrandTokens;
}

interface KitRow {
  id: string;
  name: string;
  is_master: number;
  locked: number;
  current_revision_id: string;
  deleted_at: number | null;
}

function logosFor(kitId: string, tokens: BrandTokens): BrandLogo[] {
  const spec = tokens.logo?.horizontal;
  if (!spec) return [];
  if (spec.assetId) {
    const a = getAsset(spec.assetId);
    return a ? [{ variant: "horizontal", assetId: a.id, pinnedSha256: spec.sha256, width: a.width, height: a.height, temporary: !!spec.temporary }] : [];
  }
  // Seeded (file-based) logo: resolve by the hash pinned in THIS revision, so a later logo change on
  // the brand never alters ads made with an older revision (assets are content-addressed by sha256).
  const pinned = db().prepare("SELECT id, width, height, temporary FROM assets WHERE sha256 = ?").get(spec.sha256) as { id: string; width: number | null; height: number | null; temporary: number } | undefined;
  if (pinned) return [{ variant: "horizontal", assetId: pinned.id, pinnedSha256: spec.sha256, width: pinned.width, height: pinned.height, temporary: pinned.temporary === 1 }];
  const rows = db()
    .prepare(`SELECT l.variant, l.asset_id, l.pinned_sha256, a.width, a.height, a.temporary FROM brand_kit_logos l JOIN assets a ON a.id = l.asset_id WHERE l.brand_kit_id = ?`)
    .all(kitId) as { variant: string; asset_id: string; pinned_sha256: string; width: number | null; height: number | null; temporary: number }[];
  return rows.map((l) => ({ variant: l.variant, assetId: l.asset_id, pinnedSha256: l.pinned_sha256, width: l.width, height: l.height, temporary: l.temporary === 1 }));
}

/** A brand at a given revision (default: its current one). Deleted kits still resolve for old ads. */
export function getBrand(kitId: string, revisionId?: string): Brand | undefined {
  const kit = db().prepare("SELECT * FROM brand_kits WHERE id = ?").get(kitId) as KitRow | undefined;
  if (!kit) return undefined;
  const rev = db().prepare("SELECT id, number, tokens_json FROM brand_kit_revisions WHERE id = ? AND brand_kit_id = ?").get(revisionId ?? kit.current_revision_id, kit.id) as
    | { id: string; number: number; tokens_json: string }
    | undefined;
  if (!rev) return undefined;
  const tokens = JSON.parse(rev.tokens_json) as BrandTokens;
  return { id: kit.id, name: tokens.name || kit.name, isDefault: kit.is_master === 1, locked: kit.locked === 1, revisionId: rev.id, revisionNumber: rev.number, tokens, logos: logosFor(kit.id, tokens) };
}

/** The brand new ads start with (`brand_kits.is_master` marks the default). */
export function getDefaultBrand(): Brand | undefined {
  const kit = db().prepare("SELECT id FROM brand_kits WHERE is_master = 1 AND deleted_at IS NULL").get() as { id: string } | undefined;
  return kit ? getBrand(kit.id) : undefined;
}

/** The exact brand revision a version renders with (plan §3: old ads never change). */
export function brandForVersion(versionId: string): Brand {
  const row = db().prepare("SELECT a.brand_kit_id, v.brand_revision_id FROM ad_versions v JOIN ads a ON a.id = v.ad_id WHERE v.id = ?").get(versionId) as
    | { brand_kit_id: string; brand_revision_id: string }
    | undefined;
  const brand = row ? getBrand(row.brand_kit_id, row.brand_revision_id) : undefined;
  if (!brand) throw new AppError("BRAND_NOT_FOUND", "This ad's brand revision is missing.", 500);
  return brand;
}

export function listBrands(): BrandSummary[] {
  const kits = db()
    .prepare(
      `SELECT k.id, (SELECT COUNT(*) FROM ads a WHERE a.brand_kit_id = k.id AND a.deleted_at IS NULL) AS ads
       FROM brand_kits k WHERE k.deleted_at IS NULL ORDER BY k.is_master DESC, k.created_at`,
    )
    .all() as { id: string; ads: number }[];
  return kits.map((k) => {
    const b = getBrand(k.id)!;
    return {
      id: b.id,
      name: b.name,
      isDefault: b.isDefault,
      website: b.tokens.website,
      tagline: b.tokens.tagline,
      primary: b.tokens.colors.primary ?? "#000000",
      secondary: b.tokens.colors.secondary ?? "#000000",
      logoAssetId: b.logos[0]?.assetId ?? null,
      revisionNumber: b.revisionNumber,
      adCount: k.ads,
    };
  });
}

/**
 * First run: seeds the bundled DemandMesh brand (official logo with pinned hash, OFL fonts) as the
 * default. Runs only when no brand has ever existed, so a deleted seed brand never comes back.
 */
export async function seedBundledBrand(): Promise<Brand | undefined> {
  await recordFonts();
  if (db().prepare("SELECT 1 FROM brand_kits LIMIT 1").get() || process.env.PINPO_SEED_BRAND === "0") {
    ensureDefault();
    return getDefaultBrand();
  }
  const tokens = readBundledTokens();
  const logoSpec = tokens.logo.horizontal;
  if (!logoSpec?.file) throw new AppError("BRAND_LOGO_MISSING", "brand.json has no horizontal logo", 500);
  const logoPath = path.join(SEED_DIR(), logoSpec.file);
  const bytes = readFileSync(logoPath);
  if (sha256(bytes) !== logoSpec.sha256) throw new AppError("LOGO_HASH_MISMATCH", "Bundled logo does not match its pinned sha256 — refusing to seed", 500);
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
    provenance: { sourceType: "official_brand", origin: logoSpec.origin ?? "bundled", license: `Proprietary – ${tokens.name}`, commercialUse: "yes", rightsHolder: tokens.name },
  });
  tx(() => {
    if (db().prepare("SELECT 1 FROM brand_kits LIMIT 1").get()) return;
    const t = now();
    const kitId = newId("brd");
    const revId = newId("brv");
    db().prepare("INSERT INTO brand_kits (id, name, is_master, locked, current_revision_id, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?, ?)").run(kitId, tokens.name, revId, t, t);
    db().prepare("INSERT INTO brand_kit_revisions (id, brand_kit_id, number, tokens_json, note, created_at) VALUES (?, ?, 1, ?, ?, ?)").run(revId, kitId, JSON.stringify(tokens), `Initial ${tokens.name} brand`, t);
    db().prepare("INSERT INTO brand_kit_logos (brand_kit_id, variant, asset_id, pinned_sha256) VALUES (?, 'horizontal', ?, ?)").run(kitId, logo.id, logoSpec.sha256);
  });
  return getDefaultBrand();
}

async function recordFonts(): Promise<void> {
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
}

/** Keeps exactly one default among live brands (e.g. after the default was deleted). */
function ensureDefault(): void {
  if (db().prepare("SELECT 1 FROM brand_kits WHERE is_master = 1 AND deleted_at IS NULL").get()) return;
  const first = db().prepare("SELECT id FROM brand_kits WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (!first) return;
  db().prepare("UPDATE brand_kits SET is_master = 0 WHERE is_master = 1").run();
  db().prepare("UPDATE brand_kits SET is_master = 1 WHERE id = ?").run(first.id);
}

/** Validates an uploaded logo and returns the spec pinned into the revision. */
function logoSpecFor(assetId: string, brandName: string): LogoSpec {
  const a = getAsset(assetId);
  if (!a || a.kind !== "image") throw new AppError("LOGO_NOT_FOUND", "Upload the logo again — the file wasn't found.", 422, "logoAssetId");
  // A logo becomes official once attached: the renderer only accepts this exact file (pinned hash).
  db().prepare("UPDATE assets SET official = 1, source_type = 'official_brand', license = COALESCE(license, ?), rights_holder = COALESCE(rights_holder, ?), commercial_use = 'yes' WHERE id = ?").run(`Proprietary – ${brandName}`, brandName, a.id);
  return { assetId: a.id, sha256: a.sha256, maxScale: 1.25, temporary: false };
}

/** Typography, spacing, CTA and motion are the studio's tuned layout system, shared by every brand. */
function baseTokens(): Pick<BrandTokens, "typography" | "spacing" | "cta" | "motion"> {
  const seed = readBundledTokens();
  return { typography: { ...seed.typography, fontsTemporary: false }, spacing: seed.spacing, cta: seed.cta, motion: seed.motion };
}

export function createBrand(input: BrandCreate): Brand {
  return tx(() => {
    const t = now();
    const kitId = newId("brd");
    const revId = newId("brv");
    const tokens: BrandTokens = {
      name: input.name,
      website: input.website,
      tagline: input.tagline,
      social: input.social,
      colors: derivePalette(input.primary, input.secondary),
      ...baseTokens(),
      logo: input.logoAssetId ? { horizontal: logoSpecFor(input.logoAssetId, input.name) } : {},
      approvedCtas: input.approvedCtas,
      groupBuyLine: input.groupBuyLine,
    };
    const isFirst = !db().prepare("SELECT 1 FROM brand_kits WHERE deleted_at IS NULL AND is_master = 1").get();
    db().prepare("INSERT INTO brand_kits (id, name, is_master, locked, current_revision_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)").run(kitId, input.name, isFirst ? 1 : 0, revId, t, t);
    db().prepare("INSERT INTO brand_kit_revisions (id, brand_kit_id, number, tokens_json, note, created_at) VALUES (?, ?, 1, ?, ?, ?)").run(revId, kitId, JSON.stringify(tokens), "Brand created", t);
    syncLogoRow(kitId, tokens);
    return getBrand(kitId)!;
  });
}

function syncLogoRow(kitId: string, tokens: BrandTokens): void {
  const spec = tokens.logo.horizontal;
  if (spec?.assetId) {
    db().prepare("INSERT INTO brand_kit_logos (brand_kit_id, variant, asset_id, pinned_sha256) VALUES (?, 'horizontal', ?, ?) ON CONFLICT(brand_kit_id, variant) DO UPDATE SET asset_id = excluded.asset_id, pinned_sha256 = excluded.pinned_sha256").run(kitId, spec.assetId, spec.sha256);
  } else if (!spec) {
    db().prepare("DELETE FROM brand_kit_logos WHERE brand_kit_id = ?").run(kitId);
  }
}

// ---------------- protected editing (plan §3) ----------------

/** Unlock window: edits are accepted only shortly after an explicit unlock. */
const UNLOCK_MS = 10 * 60_000;
const unlockKey = (id: string) => `brand_unlock:${id}`;

function requireKit(kitId: string): KitRow {
  const kit = db().prepare("SELECT * FROM brand_kits WHERE id = ? AND deleted_at IS NULL").get(kitId) as KitRow | undefined;
  if (!kit) throw new AppError("NOT_FOUND", "Brand not found", 404);
  return kit;
}

export function unlockBrand(kitId: string): { unlockedUntil: number } {
  requireKit(kitId);
  const until = now() + UNLOCK_MS;
  db().prepare("UPDATE brand_kits SET locked = 0, updated_at = ? WHERE id = ?").run(now(), kitId);
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(unlockKey(kitId), String(until));
  return { unlockedUntil: until };
}

/** Saves an edit as a new revision and re-locks. Requires a recent unlock (423 otherwise). */
export function updateBrand(kitId: string, patch: BrandPatch): Brand {
  return tx(() => {
    const kit = requireKit(kitId);
    const until = Number((db().prepare("SELECT value FROM settings WHERE key = ?").get(unlockKey(kitId)) as { value: string } | undefined)?.value ?? 0);
    if (kit.locked || until < now()) {
      db().prepare("UPDATE brand_kits SET locked = 1 WHERE id = ?").run(kitId);
      throw new AppError("BRAND_LOCKED", "Brand settings are locked. Unlock them first.", 423);
    }
    const current = getBrand(kitId)!;
    const name = patch.name ?? current.tokens.name;
    const tokens: BrandTokens = {
      ...current.tokens,
      name,
      ...(patch.website !== undefined ? { website: patch.website } : {}),
      ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
      ...(patch.groupBuyLine !== undefined ? { groupBuyLine: patch.groupBuyLine } : {}),
      ...(patch.approvedCtas ? { approvedCtas: patch.approvedCtas } : {}),
      ...(patch.social ? { social: patch.social } : {}),
      ...(patch.primary && patch.secondary ? { colors: derivePalette(patch.primary, patch.secondary) } : {}),
    };
    if (patch.logoAssetId !== undefined) {
      const same = current.logos[0]?.assetId === patch.logoAssetId;
      tokens.logo = patch.logoAssetId === null ? {} : same ? current.tokens.logo : { horizontal: logoSpecFor(patch.logoAssetId, name) };
    }
    const number = current.revisionNumber + 1;
    const revId = newId("brv");
    db().prepare("INSERT INTO brand_kit_revisions (id, brand_kit_id, number, tokens_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(revId, kitId, number, JSON.stringify(tokens), patch.note ?? null, now());
    db().prepare("UPDATE brand_kits SET name = ?, current_revision_id = ?, locked = 1, updated_at = ? WHERE id = ?").run(name, revId, now(), kitId);
    db().prepare("DELETE FROM settings WHERE key = ?").run(unlockKey(kitId));
    syncLogoRow(kitId, tokens);
    return getBrand(kitId)!;
  });
}

export function setDefaultBrand(kitId: string): void {
  tx(() => {
    requireKit(kitId);
    db().prepare("UPDATE brand_kits SET is_master = 0 WHERE is_master = 1").run();
    db().prepare("UPDATE brand_kits SET is_master = 1, updated_at = ? WHERE id = ?").run(now(), kitId);
  });
}

export function assertBrandDeletable(kitId: string): void {
  const kit = requireKit(kitId);
  if (kit.is_master) throw new AppError("BRAND_IS_DEFAULT", "This is the default brand. Make another brand the default first.", 409);
}

/** Soft delete: hidden from pickers; existing ads keep rendering with their pinned revision. */
export function deleteBrand(kitId: string): void {
  tx(() => {
    assertBrandDeletable(kitId);
    db().prepare("UPDATE brand_kits SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), kitId);
  });
}

export function brandRevisions(kitId: string) {
  return db().prepare("SELECT id, number, note, created_at FROM brand_kit_revisions WHERE brand_kit_id = ? ORDER BY number DESC").all(kitId) as { id: string; number: number; note: string | null; created_at: number }[];
}
