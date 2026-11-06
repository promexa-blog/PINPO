import "../../guard";
import { randomInt } from "node:crypto";
import { db, tx } from "..";
import { BriefInput, type ClaimInput } from "@/lib/brief";
import { Finishing, VersionSettings, type SceneEdit, type VersionPatch, type VoiceoverSegment } from "@/lib/version";
import type { PlatformKey } from "@/lib/platforms";
import { getBrand, getDefaultBrand, type Brand } from "../../brand/kits";
import { classify, primaryCategory } from "../../brief/claims";
import { getTemplate } from "../../planning/templates";
import { defaultPacing, type Pacing } from "../../planning/creative";
import { newId, now, AppError } from "../../util";

export interface VersionRow {
  id: string;
  ad_id: string;
  number: number;
  status: "draft" | "queued" | "generating" | "composing" | "ready" | "failed" | "canceled";
  qa_status: "none" | "running" | "passed" | "needs_review" | "failed" | "approved";
  revision: number;
  settings_json: string;
  finishing_json: string;
  settings_hash: string | null;
  platform: PlatformKey;
  pacing: Pacing;
  brand_revision_id: string;
  template_id: string | null;
  final_asset_id: string | null;
  thumb_asset_id: string | null;
  error_code: string | null;
  error_message: string | null;
  parent_version_id: string | null;
  locked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SceneRow {
  id: string;
  version_id: string;
  position: number;
  role: string;
  scene_type: SceneEdit["sceneType"];
  prompt: string;
  duration_s: number;
  shows_product: number;
  visual_direction: string;
  motion_preset: SceneEdit["motionPreset"];
  creative_json: string;
  overlay_json: string;
  product_asset_id: string | null;
  start_frame_asset_id: string | null;
  end_frame_asset_id: string | null;
  inputs_hash: string | null;
  clip_asset_id: string | null;
  reused_from_scene_id: string | null;
  status: "draft" | "pending" | "running" | "succeeded" | "failed" | "canceled" | "reused";
}

export interface ClaimRow {
  id: string;
  version_id: string;
  position: number;
  text: string;
  language: "en" | "ml" | "hi";
  category: string;
  confirmed: number;
  source: string | null;
  substantiation: string | null;
  attested_at: number | null;
  testimonial_consent: number;
}

export const DEFAULT_FINISHING: Finishing = { outroType: "standard", outroLang: "en", audioMode: "music_only", musicAssetId: null, musicVolumeDb: -8, duckClipUnderVoice: true };

export function defaultBrief(platform: PlatformKey, brand?: Brand): BriefInput {
  return BriefInput.parse({
    product: { name: "", category: "home_kitchen", appearance: "", imageAssetIds: [] },
    audience: { who: "" },
    campaign: { objective: "sales", platform },
    claims: [],
    offers: { stockConfirmed: false },
    cta: { en: brand?.tokens.approvedCtas.en?.[0] ?? (brand ? `Shop now on ${brand.tokens.website}` : "Shop now") },
    creative: { direction: "", tone: "friendly", style: "lifestyle" },
    languages: ["en"],
  });
}

/** Creates an ad with draft v1 on the chosen brand (default brand when none is given) (plan §3, §4). */
export function createAd(input: { name: string; templateKey: string; platform: PlatformKey; brandId?: string }): { adId: string; versionId: string } {
  const brand = input.brandId ? getBrand(input.brandId) : getDefaultBrand();
  if (!brand) throw new AppError(input.brandId ? "BRAND_NOT_FOUND" : "BRAND_NOT_READY", input.brandId ? "That brand doesn't exist." : "No brand yet. Create one on the Brands page first.", input.brandId ? 404 : 409);
  const template = getTemplate(input.templateKey);
  if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Template not found", 404);
  if (!template.platforms.includes(input.platform)) throw new AppError("TEMPLATE_PLATFORM", `${template.name} isn't available for this platform.`, 422);
  const brief = defaultBrief(input.platform, brand);
  const settings: VersionSettings = { templateKey: template.key, modelId: "wan-3.0", resolution: "720p", lengthS: 15, clipAudio: false, seed: randomInt(0, 2_147_483_647) };
  return tx(() => {
    const t = now();
    const adId = newId("ad");
    const versionId = newId("ver");
    db().prepare("INSERT INTO ads (id, name, brand_kit_id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(adId, input.name, brand.id, versionId, t, t);
    db()
      .prepare(
        `INSERT INTO ad_versions (id, ad_id, number, status, settings_json, finishing_json, platform, pacing, brand_revision_id, template_id, created_at, updated_at)
         VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(versionId, adId, JSON.stringify(settings), JSON.stringify({ ...DEFAULT_FINISHING, outroType: template.defaultOutro }), input.platform, defaultPacing(brief), brand.revisionId, template.id, t, t);
    writeBrief(versionId, brief);
    return { adId, versionId };
  });
}

function writeBrief(versionId: string, b: BriefInput): void {
  db()
    .prepare(
      `INSERT INTO briefs (version_id, product_json, audience_json, campaign_json, offers_json, cta_json, creative_json, languages_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(version_id) DO UPDATE SET product_json = excluded.product_json, audience_json = excluded.audience_json,
         campaign_json = excluded.campaign_json, offers_json = excluded.offers_json, cta_json = excluded.cta_json,
         creative_json = excluded.creative_json, languages_json = excluded.languages_json, updated_at = excluded.updated_at`,
    )
    .run(versionId, JSON.stringify(b.product), JSON.stringify(b.audience), JSON.stringify(b.campaign), JSON.stringify(b.offers), JSON.stringify(b.cta), JSON.stringify(b.creative), JSON.stringify(b.languages), now());
}

export function getVersion(id: string): VersionRow | undefined {
  return db().prepare("SELECT * FROM ad_versions WHERE id = ?").get(id) as VersionRow | undefined;
}

export function requireVersion(id: string): VersionRow {
  const v = getVersion(id);
  if (!v) throw new AppError("NOT_FOUND", "Version not found", 404);
  return v;
}

export function getBrief(versionId: string): BriefInput {
  const r = db().prepare("SELECT * FROM briefs WHERE version_id = ?").get(versionId) as Record<string, string> | undefined;
  if (!r) throw new AppError("NOT_FOUND", "Brief not found", 404);
  const claims = getClaims(versionId).map((c) => ({
    id: c.id,
    language: c.language,
    text: c.text,
    confirmed: !!c.confirmed,
    source: c.source,
    substantiation: c.substantiation,
    attested: c.attested_at !== null,
    testimonialConsent: !!c.testimonial_consent,
  }));
  return BriefInput.parse({
    product: JSON.parse(r.product_json!),
    audience: JSON.parse(r.audience_json!),
    campaign: JSON.parse(r.campaign_json!),
    offers: JSON.parse(r.offers_json!),
    cta: JSON.parse(r.cta_json!),
    creative: JSON.parse(r.creative_json!),
    languages: JSON.parse(r.languages_json!),
    claims,
  });
}

export function getClaims(versionId: string): ClaimRow[] {
  return db().prepare("SELECT * FROM claims WHERE version_id = ? ORDER BY language, position").all(versionId) as ClaimRow[];
}

export function getScenes(versionId: string): SceneRow[] {
  return db().prepare("SELECT * FROM scenes WHERE version_id = ? ORDER BY position").all(versionId) as SceneRow[];
}

export function settingsOf(v: VersionRow): VersionSettings {
  return VersionSettings.parse(JSON.parse(v.settings_json));
}
export function finishingOf(v: VersionRow): Finishing {
  return Finishing.parse(JSON.parse(v.finishing_json));
}

export function sceneToEdit(s: SceneRow): SceneEdit {
  const overlay = JSON.parse(s.overlay_json) as SceneEdit["overlay"];
  return {
    id: s.id,
    role: s.role,
    label: (JSON.parse(s.creative_json) as { label?: string }).label ?? s.role,
    sceneType: s.scene_type,
    showsProduct: !!s.shows_product,
    durationS: s.duration_s,
    visualDirection: s.visual_direction,
    prompt: s.prompt,
    motionPreset: s.motion_preset,
    creative: JSON.parse(s.creative_json) as SceneEdit["creative"],
    overlay,
    productAssetId: s.product_asset_id,
  };
}

function writeClaims(versionId: string, claims: ClaimInput[]): void {
  db().prepare("DELETE FROM claims WHERE version_id = ?").run(versionId);
  const ins = db().prepare(
    `INSERT INTO claims (id, version_id, position, text, language, category, confirmed, source, substantiation, attested_at, testimonial_consent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const pos: Record<string, number> = {};
  const t = now();
  for (const c of claims) {
    const p = (pos[c.language] = (pos[c.language] ?? -1) + 1);
    ins.run(c.id ?? newId("clm"), versionId, p, c.text, c.language, primaryCategory(classify(c.text)), c.confirmed ? 1 : 0, c.source ?? null, c.substantiation ?? null, c.attested ? t : null, c.testimonialConsent ? 1 : 0, t);
  }
}

export function writeScenes(versionId: string, scenes: SceneEdit[]): void {
  db().prepare("DELETE FROM scenes WHERE version_id = ?").run(versionId);
  const ins = db().prepare(
    `INSERT INTO scenes (id, version_id, position, role, scene_type, prompt, duration_s, shows_product, visual_direction, motion_preset, creative_json, overlay_json, product_asset_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  );
  scenes.forEach((s, i) =>
    ins.run(
      s.id ?? newId("scn"), versionId, i, s.role, s.sceneType, s.prompt, s.durationS, s.showsProduct ? 1 : 0, s.visualDirection, s.motionPreset,
      JSON.stringify({ ...s.creative, label: s.label }), JSON.stringify(s.overlay), s.productAssetId,
    ),
  );
}

/** Autosave (plan §4, A5): optimistic `revision`; locked versions are read-only (423). */
export function patchDraft(versionId: string, patch: VersionPatch): VersionRow {
  return tx(() => {
    const v = requireVersion(versionId);
    if (v.status !== "draft") throw new AppError("VERSION_LOCKED", "This version has been generated and can't be edited. Create a new version from it.", 423);
    if (patch.revision !== v.revision) throw new AppError("REVISION_CONFLICT", "This draft was changed in another tab. Reload to see the latest version.", 409);
    const sets: string[] = ["revision = revision + 1", "updated_at = ?"];
    const vals: unknown[] = [now()];
    if (patch.settings) {
      sets.push("settings_json = ?");
      vals.push(JSON.stringify(patch.settings));
    }
    if (patch.finishing) {
      sets.push("finishing_json = ?");
      vals.push(JSON.stringify(patch.finishing));
    }
    if (patch.platform) {
      sets.push("platform = ?");
      vals.push(patch.platform);
    }
    if (patch.pacing) {
      sets.push("pacing = ?");
      vals.push(patch.pacing);
    }
    vals.push(versionId);
    db().prepare(`UPDATE ad_versions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    if (patch.brief) writeBrief(versionId, patch.brief);
    const claims = patch.claims ?? patch.brief?.claims;
    if (claims) writeClaims(versionId, claims);
    if (patch.scenes) writeScenes(versionId, patch.scenes);
    if (patch.voiceovers) writeVoiceovers(versionId, patch.voiceovers);
    if (patch.name) db().prepare("UPDATE ads SET name = ?, updated_at = ? WHERE id = ?").run(patch.name, now(), v.ad_id);
    return requireVersion(versionId);
  });
}

export function writeVoiceovers(versionId: string, segs: VoiceoverSegment[]): void {
  db().prepare("DELETE FROM audio_tracks WHERE version_id = ? AND kind = 'voiceover'").run(versionId);
  const ins = db().prepare(
    `INSERT INTO audio_tracks (id, version_id, kind, scene_position, asset_id, offset_s, volume_db, fade_in_s, fade_out_s, duck, muted, source)
     VALUES (?, ?, 'voiceover', ?, ?, ?, ?, ?, ?, 1, ?, 'upload')`,
  );
  for (const s of segs) {
    const a = db().prepare("SELECT kind FROM assets WHERE id = ?").get(s.assetId) as { kind: string } | undefined;
    if (a?.kind !== "audio") throw new AppError("NOT_AUDIO", "Voiceover must be an uploaded audio file.", 422);
    ins.run(newId("trk"), versionId, s.scenePosition, s.assetId, s.offsetS, s.volumeDb, s.fadeInS, s.fadeOutS, s.muted ? 1 : 0);
  }
}

export function getVoiceovers(versionId: string): (VoiceoverSegment & { id: string; durationS: number | null; talentConsent: boolean; commercialUse: string })[] {
  return (
    db()
      .prepare(
        `SELECT t.*, a.duration_s, a.talent_consent, a.commercial_use FROM audio_tracks t JOIN assets a ON a.id = t.asset_id
         WHERE t.version_id = ? AND t.kind = 'voiceover' ORDER BY t.scene_position, t.offset_s`,
      )
      .all(versionId) as { id: string; asset_id: string; scene_position: number; offset_s: number; volume_db: number; fade_in_s: number; fade_out_s: number; muted: number; duration_s: number | null; talent_consent: number; commercial_use: string }[]
  ).map((r) => ({
    id: r.id,
    assetId: r.asset_id,
    scenePosition: r.scene_position,
    offsetS: r.offset_s,
    volumeDb: r.volume_db,
    fadeInS: r.fade_in_s,
    fadeOutS: r.fade_out_s,
    muted: !!r.muted,
    durationS: r.duration_s,
    talentConsent: !!r.talent_consent,
    commercialUse: r.commercial_use,
  }));
}

export function listAds() {
  return db()
    .prepare(
      `SELECT a.id, a.name, a.updated_at, v.id AS version_id, v.number, v.status, v.qa_status, v.platform, v.settings_json, v.thumb_asset_id, v.final_asset_id,
              (SELECT COUNT(*) FROM ad_versions vv WHERE vv.ad_id = a.id) AS version_count
       FROM ads a JOIN ad_versions v ON v.id = a.current_version_id
       WHERE a.deleted_at IS NULL ORDER BY a.updated_at DESC`,
    )
    .all() as {
    id: string;
    name: string;
    updated_at: number;
    version_id: string;
    number: number;
    status: VersionRow["status"];
    qa_status: VersionRow["qa_status"];
    platform: PlatformKey;
    settings_json: string;
    thumb_asset_id: string | null;
    final_asset_id: string | null;
    version_count: number;
  }[];
}
