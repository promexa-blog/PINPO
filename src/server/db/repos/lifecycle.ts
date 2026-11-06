import "../../guard";
import { db, tx } from "..";
import { getBrand } from "../../brand/kits";
import { newId, now, AppError } from "../../util";
import { requireVersion, type VersionRow } from "./versions";

/** Non-destructive versioning, duplication and deletion (plan §3, §12). */

/** Copies a version's draft content (brief, claims, scenes, voiceovers) into a new draft row. */
function copyInto(from: VersionRow, adId: string, number: number, parent: string | null): string {
  const t = now();
  const id = newId("ver");
  // New drafts pick up the brand's latest revision (old versions keep theirs).
  const kitId = (db().prepare("SELECT brand_kit_id FROM ads WHERE id = ?").get(adId) as { brand_kit_id: string } | undefined)?.brand_kit_id;
  const brand = kitId ? getBrand(kitId) : undefined;
  db()
    .prepare(
      `INSERT INTO ad_versions (id, ad_id, number, status, settings_json, finishing_json, platform, pacing, brand_revision_id, template_id, parent_version_id, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, adId, number, from.settings_json, from.finishing_json, from.platform, from.pacing, brand?.revisionId ?? from.brand_revision_id, from.template_id, parent, t, t);
  db()
    .prepare(
      `INSERT INTO briefs (version_id, product_json, audience_json, campaign_json, offers_json, cta_json, creative_json, languages_json, updated_at)
       SELECT ?, product_json, audience_json, campaign_json, offers_json, cta_json, creative_json, languages_json, ? FROM briefs WHERE version_id = ?`,
    )
    .run(id, t, from.id);
  // Claims keep fresh IDs; overlay lines are re-pointed to them below.
  const claimMap = new Map<string, string>();
  for (const c of db().prepare("SELECT * FROM claims WHERE version_id = ?").all(from.id) as Record<string, unknown>[]) {
    const nid = newId("clm");
    claimMap.set(String(c.id), nid);
    db()
      .prepare(`INSERT INTO claims (id, version_id, position, text, language, category, confirmed, source, substantiation, attested_at, testimonial_consent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(nid, id, c.position, c.text, c.language, c.category, c.confirmed, c.source, c.substantiation, c.attested_at, c.testimonial_consent, t);
  }
  for (const s of db().prepare("SELECT * FROM scenes WHERE version_id = ? ORDER BY position").all(from.id) as Record<string, unknown>[]) {
    let overlay = String(s.overlay_json);
    for (const [o, n] of claimMap) overlay = overlay.replaceAll(o, n);
    db()
      .prepare(
        `INSERT INTO scenes (id, version_id, position, role, scene_type, prompt, duration_s, shows_product, visual_direction, motion_preset, creative_json, overlay_json, product_asset_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      )
      .run(newId("scn"), id, s.position, s.role, s.scene_type, s.prompt, s.duration_s, s.shows_product, s.visual_direction, s.motion_preset, s.creative_json, overlay, s.product_asset_id);
  }
  db()
    .prepare(
      `INSERT INTO audio_tracks (id, version_id, kind, scene_position, asset_id, offset_s, volume_db, fade_in_s, fade_out_s, duck, muted, source)
       SELECT 'trk_' || lower(hex(randomblob(10))), ?, kind, scene_position, asset_id, offset_s, volume_db, fade_in_s, fade_out_s, duck, muted, source FROM audio_tracks WHERE version_id = ? AND kind = 'voiceover'`,
    )
    .run(id, from.id);
  return id;
}

/** "New version from this" — a new draft; earlier versions and finals stay untouched. */
export function forkVersion(versionId: string): { versionId: string; created: boolean } {
  return tx(() => {
    const v = requireVersion(versionId);
    const draft = db().prepare("SELECT id FROM ad_versions WHERE ad_id = ? AND status = 'draft'").get(v.ad_id) as { id: string } | undefined;
    if (draft) return { versionId: draft.id, created: false };
    const next = (db().prepare("SELECT MAX(number) AS n FROM ad_versions WHERE ad_id = ?").get(v.ad_id) as { n: number }).n + 1;
    const id = copyInto(v, v.ad_id, next, v.id);
    db().prepare("UPDATE ads SET current_version_id = ?, updated_at = ? WHERE id = ?").run(id, now(), v.ad_id);
    return { versionId: id, created: true };
  });
}

/** Library "Duplicate": a new ad whose v1 draft copies this version. */
export function duplicateAd(adId: string): { adId: string; versionId: string } {
  return tx(() => {
    const ad = db().prepare("SELECT * FROM ads WHERE id = ? AND deleted_at IS NULL").get(adId) as { id: string; name: string; brand_kit_id: string; current_version_id: string } | undefined;
    if (!ad) throw new AppError("NOT_FOUND", "Ad not found", 404);
    const v = requireVersion(ad.current_version_id);
    const t = now();
    const newAd = newId("ad");
    db().prepare("INSERT INTO ads (id, name, brand_kit_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(newAd, `${ad.name} (copy)`.slice(0, 120), ad.brand_kit_id, t, t);
    const vid = copyInto(v, newAd, 1, null);
    db().prepare("UPDATE ads SET current_version_id = ? WHERE id = ?").run(vid, newAd);
    return { adId: newAd, versionId: vid };
  });
}

/** Soft delete; files are removed by the GC after the grace period (plan §9). */
export function deleteAd(adId: string): void {
  const running = db().prepare("SELECT 1 FROM ad_versions WHERE ad_id = ? AND status IN ('queued','generating','composing')").get(adId);
  if (running) throw new AppError("AD_RUNNING", "Cancel the running generation before deleting this ad.", 409);
  const r = db().prepare("UPDATE ads SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now(), now(), adId);
  if (r.changes !== 1) throw new AppError("NOT_FOUND", "Ad not found", 404);
}

/** Deletes a non-current, non-running version (plan §4 DELETE /api/versions/[vid]). */
export function deleteVersion(versionId: string): void {
  tx(() => {
    const v = requireVersion(versionId);
    const ad = db().prepare("SELECT current_version_id FROM ads WHERE id = ?").get(v.ad_id) as { current_version_id: string };
    if (ad.current_version_id === versionId) throw new AppError("VERSION_CURRENT", "You can't delete the current version.", 409);
    if (["queued", "generating", "composing"].includes(v.status)) throw new AppError("VERSION_RUNNING", "This version is still running.", 409);
    const jobIds = db().prepare("SELECT id FROM jobs WHERE version_id = ?").all(versionId) as { id: string }[];
    for (const j of jobIds) db().prepare("DELETE FROM job_events WHERE job_id = ?").run(j.id);
    db().prepare("DELETE FROM cost_entries WHERE version_id = ?").run(versionId);
    db().prepare("DELETE FROM jobs WHERE version_id = ?").run(versionId);
    db().prepare("DELETE FROM qa_items WHERE report_id IN (SELECT id FROM qa_reports WHERE version_id = ?)").run(versionId);
    db().prepare("DELETE FROM qa_reports WHERE version_id = ?").run(versionId);
    db().prepare("DELETE FROM attestations WHERE version_id = ?").run(versionId);
    db().prepare("UPDATE ad_versions SET parent_version_id = NULL WHERE parent_version_id = ?").run(versionId);
    db().prepare("UPDATE scenes SET reused_from_scene_id = NULL WHERE reused_from_scene_id IN (SELECT id FROM scenes WHERE version_id = ?)").run(versionId);
    db().prepare("DELETE FROM ad_versions WHERE id = ?").run(versionId); // briefs/claims/scenes/audio cascade
  });
}

/** Points the ad at another existing version (version switcher). */
export function setCurrentVersion(adId: string, versionId: string): void {
  const v = requireVersion(versionId);
  if (v.ad_id !== adId) throw new AppError("NOT_FOUND", "Version not found for this ad", 404);
  db().prepare("UPDATE ads SET current_version_id = ?, updated_at = ? WHERE id = ?").run(versionId, now(), adId);
}
