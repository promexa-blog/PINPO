import { db } from "@/server/db";
import { seedTemplates } from "@/server/planning/templates";
import { StudioHeader } from "../_components/header";
import { TemplateDelete } from "../_components/template-delete";

export const dynamic = "force-dynamic";

export default function TemplatesPage() {
  seedTemplates();
  const rows = db().prepare("SELECT key, name, description, builtin, scenes_json, default_outro_type FROM templates ORDER BY builtin DESC, name").all() as { key: string; name: string; description: string; builtin: number; scenes_json: string; default_outro_type: string }[];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8">
      <StudioHeader />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Templates</h1>
      <p className="mt-1 max-w-prose text-sm text-dm-secondary">Each template sets the scene roles and timing of an ad. The look of each scene still adapts to the product. Save your own from any ad with &quot;Save as template&quot;.</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {rows.map((t) => {
          const scenes = JSON.parse(t.scenes_json) as { label: string; sceneType: string; minLengthS: number }[];
          return (
            <li key={t.key} className="rounded-xl border border-dm-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">{t.name}</h2>
                  <p className="mt-1 text-sm text-dm-secondary">{t.description}</p>
                </div>
                {t.builtin ? <span className="text-xs text-dm-secondary">Built-in</span> : <TemplateDelete templateKey={t.key} name={t.name} />}
              </div>
              <ol className="mt-3 grid gap-1 text-sm">
                {scenes.map((s, i) => (
                  <li key={i}>
                    {i + 1}. {s.label} <span className="text-xs text-dm-secondary">({s.sceneType === "product_original" ? "original product" : s.sceneType === "ai_scene" ? "AI scene" : "AI with product"}{s.minLengthS > 15 ? `, ${s.minLengthS}s+ ads` : ""})</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-dm-secondary">Default outro: {t.default_outro_type}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
