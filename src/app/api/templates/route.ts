import { route } from "@/server/http";
import { db } from "@/server/db";
import { seedTemplates } from "@/server/planning/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  seedTemplates();
  const rows = db().prepare("SELECT key, name, description, platforms_json, lengths_json, scenes_json, default_outro_type, builtin FROM templates ORDER BY builtin DESC, name").all() as Record<string, string | number>[];
  return Response.json({
    templates: rows.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      platforms: JSON.parse(String(r.platforms_json)),
      lengths: JSON.parse(String(r.lengths_json)),
      roles: (JSON.parse(String(r.scenes_json)) as { label: string; minLengthS: number }[]).map((s) => ({ label: s.label, minLengthS: s.minLengthS })),
      defaultOutro: r.default_outro_type,
      builtin: r.builtin === 1,
    })),
  });
});
