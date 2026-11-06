import "../guard";
import { db } from "../db";
import { seedTemplates } from "./templates";

/** Read model for template pickers/galleries: scene strip proportions and where it can run. */
export interface TemplateCard {
  key: string;
  name: string;
  description: string;
  builtin: boolean;
  platforms: string[];
  lengths: number[];
  defaultOutro: string;
  scenes: { label: string; weight: number; kind: "original" | "ai_product" | "ai"; minLengthS: number }[];
}

export function templateCards(): TemplateCard[] {
  seedTemplates();
  const rows = db().prepare("SELECT key, name, description, builtin, scenes_json, platforms_json, lengths_json, default_outro_type FROM templates ORDER BY builtin DESC, name").all() as {
    key: string;
    name: string;
    description: string;
    builtin: number;
    scenes_json: string;
    platforms_json: string;
    lengths_json: string;
    default_outro_type: string;
  }[];
  return rows.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    builtin: t.builtin === 1,
    platforms: JSON.parse(t.platforms_json) as string[],
    lengths: JSON.parse(t.lengths_json) as number[],
    defaultOutro: t.default_outro_type,
    scenes: (JSON.parse(t.scenes_json) as { label: string; weight?: number; sceneType: string; minLengthS?: number }[]).map((s) => ({
      label: s.label,
      weight: s.weight ?? 1,
      kind: s.sceneType === "product_original" ? "original" : s.sceneType === "ai_scene" ? "ai" : "ai_product",
      minLengthS: s.minLengthS ?? 15,
    })),
  }));
}
