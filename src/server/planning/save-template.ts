import "../guard";
import { db } from "../db";
import { getTemplate, TemplateDef, type TemplateSceneDef } from "./templates";
import { draftScenes } from "./draft";
import { requireVersion, settingsOf, finishingOf } from "../db/repos/versions";
import { newId, now, AppError } from "../util";

/**
 * "Save as template" (plan §5): keeps the version's scene STRUCTURE (roles, timing weights, scene
 * types, creative intent, overlay sources) — never its product-specific copy or claims.
 */
export function saveAsTemplate(versionId: string, name: string): { key: string } {
  const v = requireVersion(versionId);
  const settings = settingsOf(v);
  const finishing = finishingOf(v);
  const scenes = draftScenes(versionId);
  if (!scenes.length) throw new AppError("NO_SCENES", "Build the storyboard before saving it as a template.", 409);
  const source = getTemplate(settings.templateKey);
  const lang = finishing.outroLang;
  let claimIndex = 0;
  const roleSeen = new Map<string, number>();
  const out: TemplateSceneDef[] = scenes.map((s) => {
    const kinds = (s.overlay.byLang[lang] ?? []).map((l) => l.kind);
    const src = kinds.includes("group_price")
      ? "group_buy"
      : kinds.some((k) => k.startsWith("offer_"))
        ? kinds.includes("cta") ? "offer_or_cta" : "offer"
        : kinds.includes("claim") || kinds.includes("placeholder")
          ? `claim:${Math.min(9, claimIndex++)}`
          : kinds.includes("product_name") ? "product_name" : kinds.includes("tagline") ? "tagline" : kinds.includes("brand_line") ? "brand_line" : "cta";
    const n = (roleSeen.get(s.role) ?? 0) + 1;
    roleSeen.set(s.role, n);
    const original = source?.scenes.find((x) => x.role === s.role);
    return {
      role: n > 1 ? `${s.role}_${n}` : s.role,
      label: s.label,
      weight: Math.max(0.2, Math.round((s.durationS / 3) * 100) / 100),
      sceneType: s.sceneType === "ai_reference" ? "ai_from_product" : s.sceneType,
      showsProduct: s.showsProduct,
      minLengthS: 15,
      visualDirection: s.visualDirection,
      ...(s.sceneType !== "product_original" ? { promptScaffold: original?.promptScaffold ?? "{appearance}. {camera}. {lighting}. Set on {setting}. {toneMood}." } : {}),
      ...(s.sceneType === "product_original" ? { productMotion: s.creative.productMotion } : {}),
      overlay: { source: src, layout: s.overlay.layout, motion: s.overlay.motion },
    };
  });
  const key = `user_${name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "template"}_${newId("t").slice(-6).replace(/[^a-z]/g, "x")}`;
  const def = TemplateDef.parse({
    key,
    name: name.slice(0, 80),
    description: `Saved from version ${v.number}${source ? ` (based on ${source.name})` : ""}.`,
    platforms: source?.platforms ?? ["instagram_reels"],
    lengths: [15, 30, 45, 60],
    defaultOutro: finishing.outroType,
    cta: { placement: "final_scene_and_outro" },
    scenes: out,
  });
  const t = now();
  db()
    .prepare(`INSERT INTO templates (id, key, name, description, builtin, scenes_json, cta_spec_json, default_outro_type, platforms_json, lengths_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId("tpl"), def.key, def.name, def.description, JSON.stringify(def.scenes), JSON.stringify(def.cta), def.defaultOutro, JSON.stringify(def.platforms), JSON.stringify(def.lengths), t, t);
  return { key: def.key };
}

export function deleteUserTemplate(key: string): void {
  const r = db().prepare("DELETE FROM templates WHERE key = ? AND builtin = 0").run(key);
  if (r.changes !== 1) throw new AppError("TEMPLATE_PROTECTED", "Built-in templates can't be deleted.", 409);
}
