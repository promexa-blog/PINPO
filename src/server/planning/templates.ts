import "../guard";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../paths";
import { db } from "../db";
import { newId, now } from "../util";
import { LAYOUTS, MOTION_PRESETS, PRODUCT_MOTIONS } from "./creative";

export const TemplateScene = z.object({
  role: z.string().regex(/^[a-z_]+$/),
  label: z.string(),
  weight: z.number().positive(),
  sceneType: z.enum(["product_original", "ai_from_product", "ai_reference", "ai_scene"]),
  showsProduct: z.boolean(),
  minLengthS: z.number().int().min(15).max(60),
  visualDirection: z.string(),
  promptScaffold: z.string().optional(),
  productMotion: z.enum(PRODUCT_MOTIONS).optional(),
  overlay: z.object({
    source: z.string().regex(/^(product_name|claim:\d|offer_or_cta|cta|offer|tagline|group_buy)$/),
    layout: z.enum(LAYOUTS),
    motion: z.enum(MOTION_PRESETS),
  }),
});

export const TemplateDef = z.object({
  key: z.string().regex(/^[a-z_]+$/),
  name: z.string(),
  description: z.string(),
  platforms: z.array(z.string()).min(1),
  lengths: z.array(z.number().int()).min(1),
  defaultOutro: z.enum(["standard", "promotional", "product", "minimal"]),
  cta: z.object({ placement: z.string() }),
  scenes: z.array(TemplateScene).min(1),
});
export type TemplateDef = z.infer<typeof TemplateDef>;
export type TemplateSceneDef = z.infer<typeof TemplateScene>;

export function loadBundledTemplates(): TemplateDef[] {
  return readdirSync(paths.bundled.templates)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => TemplateDef.parse(JSON.parse(readFileSync(path.join(paths.bundled.templates, f), "utf8"))));
}

/** Upserts built-in templates (read-only in the UI). */
export function seedTemplates(): void {
  const t = now();
  const upsert = db().prepare(
    `INSERT INTO templates (id, key, name, description, builtin, scenes_json, cta_spec_json, default_outro_type, platforms_json, lengths_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description, scenes_json = excluded.scenes_json,
       cta_spec_json = excluded.cta_spec_json, default_outro_type = excluded.default_outro_type, platforms_json = excluded.platforms_json,
       lengths_json = excluded.lengths_json, updated_at = excluded.updated_at
     WHERE templates.builtin = 1`,
  );
  for (const tpl of loadBundledTemplates()) {
    upsert.run(newId("tpl"), tpl.key, tpl.name, tpl.description, JSON.stringify(tpl.scenes), JSON.stringify(tpl.cta), tpl.defaultOutro, JSON.stringify(tpl.platforms), JSON.stringify(tpl.lengths), t, t);
  }
}

export function getTemplate(idOrKey: string): (TemplateDef & { id: string }) | undefined {
  const row = db().prepare("SELECT * FROM templates WHERE id = ? OR key = ?").get(idOrKey, idOrKey) as
    | { id: string; key: string; name: string; description: string; scenes_json: string; cta_spec_json: string; default_outro_type: string; platforms_json: string; lengths_json: string }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    ...TemplateDef.parse({
      key: row.key,
      name: row.name,
      description: row.description,
      scenes: JSON.parse(row.scenes_json),
      cta: JSON.parse(row.cta_spec_json),
      defaultOutro: row.default_outro_type,
      platforms: JSON.parse(row.platforms_json),
      lengths: JSON.parse(row.lengths_json),
    }),
  };
}
