import "../guard";
import { db } from "../db";
import { getBrief, getScenes, finishingOf, requireVersion, getVoiceovers } from "../db/repos/versions";
import { getMasterBrand } from "../brand/master";
import { getAsset } from "../storage/assets";
import type { UsedAsset } from "./checks/rights";

/** Every asset that ends up in a version's video (for the rights gate and credits). */
export function usedAssets(versionId: string): UsedAsset[] {
  const v = requireVersion(versionId);
  const out: UsedAsset[] = [];
  const push = (id: string | null | undefined, role: UsedAsset["role"]) => {
    const a = id ? getAsset(id) : undefined;
    if (a) out.push({ asset: a, role });
  };
  for (const s of getScenes(versionId)) {
    push(s.clip_asset_id, "clip");
    push(s.product_asset_id, "product");
  }
  const brief = getBrief(versionId);
  const finishing = finishingOf(v);
  if (finishing.outroType === "product") push(brief.product.imageAssetIds[0], "product");
  for (const id of brief.product.imageAssetIds) {
    // reference images are used by reference-mode scenes
    const usedAsRef = db().prepare("SELECT 1 FROM jobs WHERE version_id = ? AND input_json LIKE ?").get(versionId, `%${id}%`);
    if (usedAsRef) push(id, "product");
  }
  push(finishing.musicAssetId, "music");
  for (const vo of getVoiceovers(versionId).filter((x) => !x.muted)) push(vo.assetId, "voiceover");
  const brand = getMasterBrand();
  for (const l of brand?.logos ?? []) push(l.assetId, "logo");
  for (const f of db().prepare("SELECT id FROM assets WHERE source_type = 'font'").all() as { id: string }[]) push(f.id, "font");
  return out;
}
