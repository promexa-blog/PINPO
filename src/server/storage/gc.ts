import "../guard";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { paths } from "../paths";
import { absolutePath, type AssetRow } from "./assets";
import { deleteVersion } from "../db/repos/lifecycle";

const DAY = 86_400_000;

/** Every asset id still referenced anywhere (plan §9 storage management). */
function referencedAssetIds(): Set<string> {
  const ids = new Set<string>();
  const add = (rows: Record<string, unknown>[]) => rows.forEach((r) => Object.values(r).forEach((v) => typeof v === "string" && v.startsWith("ast_") && ids.add(v)));
  add(db().prepare("SELECT product_asset_id, clip_asset_id, start_frame_asset_id, end_frame_asset_id FROM scenes").all() as Record<string, unknown>[]);
  add(db().prepare("SELECT final_asset_id, thumb_asset_id FROM ad_versions").all() as Record<string, unknown>[]);
  add(db().prepare("SELECT asset_id FROM brand_kit_logos UNION SELECT asset_id FROM brand_kit_products UNION SELECT asset_id FROM audio_tracks").all() as Record<string, unknown>[]);
  const jsonish = [
    ...(db().prepare("SELECT product_json AS j FROM briefs").all() as { j: string }[]),
    ...(db().prepare("SELECT finishing_json AS j FROM ad_versions").all() as { j: string }[]),
    ...(db().prepare("SELECT input_json AS j FROM jobs").all() as { j: string }[]),
  ];
  for (const { j } of jsonish) for (const m of j.matchAll(/ast_[a-f0-9]{20}/g)) ids.add(m[0]);
  for (const r of db().prepare("SELECT id FROM assets WHERE official = 1 OR source = 'seed'").all() as { id: string }[]) ids.add(r.id);
  return ids;
}

export interface GcResult {
  purgedAds: number;
  deletedAssets: number;
  freedBytes: number;
  cacheFilesRemoved: number;
}

/** Purge soft-deleted ads (>7 days), unreferenced assets (>24 h), and cache beyond `cacheCapBytes`. */
export async function collectGarbage(at = Date.now(), cacheCapBytes = 5 * 1024 ** 3): Promise<GcResult> {
  const result: GcResult = { purgedAds: 0, deletedAssets: 0, freedBytes: 0, cacheFilesRemoved: 0 };
  for (const ad of db().prepare("SELECT id FROM ads WHERE deleted_at IS NOT NULL AND deleted_at < ?").all(at - 7 * DAY) as { id: string }[]) {
    db().prepare("UPDATE ads SET current_version_id = NULL WHERE id = ?").run(ad.id);
    for (const v of db().prepare("SELECT id FROM ad_versions WHERE ad_id = ?").all(ad.id) as { id: string }[]) deleteVersion(v.id);
    db().prepare("DELETE FROM ads WHERE id = ?").run(ad.id);
    result.purgedAds++;
  }
  const keep = referencedAssetIds();
  for (const a of db().prepare("SELECT * FROM assets WHERE created_at < ?").all(at - DAY) as AssetRow[]) {
    if (keep.has(a.id)) continue;
    try {
      await rm(absolutePath(a), { force: true });
    } catch {
      /* already gone */
    }
    db().prepare("DELETE FROM assets WHERE id = ?").run(a.id);
    result.deletedAssets++;
    result.freedBytes += a.bytes;
  }
  // Cache LRU (normalized clips etc.) — regenerable, so trimming is always safe.
  const files = await Promise.all(
    (await readdir(paths.cache).catch(() => [] as string[])).map(async (f) => {
      const full = path.join(paths.cache, f);
      const s = await stat(full).catch(() => null);
      return s ? { full, size: s.size, atime: s.atimeMs } : null;
    }),
  );
  let total = files.reduce((sum, f) => sum + (f?.size ?? 0), 0);
  for (const f of files.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.atime - b.atime)) {
    if (total <= cacheCapBytes) break;
    await rm(f.full, { force: true });
    total -= f.size;
    result.cacheFilesRemoved++;
    result.freedBytes += f.size;
  }
  return result;
}
