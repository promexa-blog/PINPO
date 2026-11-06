import "../../guard";
import type { AssetRow } from "../../storage/assets";
import type { QaItem } from "./compliance";

/**
 * Asset rights gate + credits (plan §8a [v2.2]):
 * - fail: commercial use "no", licence expired, voiceover without talent consent
 * - needs review: commercial use "unknown"
 * - credits: every attribution text, collected for credits.txt and the export panel.
 */

export interface UsedAsset {
  asset: AssetRow;
  role: "product" | "music" | "voiceover" | "clip" | "font" | "logo";
}

const ROLE: Record<UsedAsset["role"], string> = { product: "Product photo", music: "Music", voiceover: "Voiceover", clip: "Scene clip", font: "Font", logo: "Logo" };

export function rightsItems(used: UsedAsset[], now = Date.now()): QaItem[] {
  const seen = new Set<string>();
  const uniq = used.filter((u) => (seen.has(u.asset.id) ? false : (seen.add(u.asset.id), true)));
  const fails: string[] = [];
  const reviews: string[] = [];
  for (const { asset: a, role } of uniq) {
    const name = `${ROLE[role]}${a.original_name ? ` "${a.original_name}"` : ""}`;
    if (a.commercial_use === "no") fails.push(`${name} can't be used commercially.`);
    else if (a.commercial_use === "unknown") reviews.push(`${name}: commercial-use rights unknown — confirm before export.`);
    if (a.license_expires_at !== null && a.license_expires_at < now) fails.push(`${name}: licence expired on ${new Date(a.license_expires_at).toISOString().slice(0, 10)}.`);
    if (role === "voiceover" && !a.talent_consent) fails.push(`${name}: no recorded consent from the voice artist for commercial ad use.`);
    if (/CC BY/i.test(a.license ?? "") && !a.attribution_text?.trim()) fails.push(`${name}: the ${a.license} licence needs a credit line.`);
  }
  const items: QaItem[] = [];
  if (fails.length) items.push({ check: "asset_rights", method: "automated", status: "fail", message: fails.join(" ") });
  if (reviews.length) items.push({ check: "asset_rights", method: "human", status: "needs_review", message: reviews.join(" ") });
  if (!fails.length && !reviews.length) items.push({ check: "asset_rights", method: "automated", status: "pass", message: `All ${uniq.length} assets used have commercial-use permission${uniq.some((u) => u.asset.attribution_text) ? " (credits included in credits.txt)" : ""}.` });
  return items;
}

/** Plain-text credits for every used asset that carries an attribution or third-party licence. */
export function creditsText(used: UsedAsset[], adName: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { asset: a, role } of used) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const thirdParty = a.source_type === "stock_licensed" || a.source_type === "commissioned" || a.source_type === "font" || a.source_type === "product_supplier" || !!a.attribution_text;
    if (!thirdParty) continue;
    const parts = [a.attribution_text?.trim() || a.original_name || ROLE[role], a.rights_holder ? `© ${a.rights_holder}` : null, a.license ? `Licence: ${a.license}` : null, a.origin ? `Source: ${a.origin}` : null].filter(Boolean);
    lines.push(`- ${ROLE[role]}: ${parts.join(" · ")}`);
  }
  return [`Credits — ${adName}`, `Made with PINPO.`, "", ...(lines.length ? lines : ["No third-party credits required."]), ""].join("\n");
}
