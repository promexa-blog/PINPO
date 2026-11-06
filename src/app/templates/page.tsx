import Link from "next/link";
import { templateCards } from "@/server/planning/template-cards";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { SceneLegend, SceneStrip } from "../_components/scene-strip";
import { TemplateDelete } from "../_components/template-delete";
import { AspectGlyph } from "../_components/frame";
import { PageTitle, Status, buttonClass } from "../_components/ui";
import { IconArrowRight } from "../_components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Templates" };

const OUTRO_LABEL: Record<string, string> = { standard: "Logo + tagline ending", promotional: "Offer ending", product: "Product ending", minimal: "Logo-only ending" };

export default function TemplatesPage() {
  const templates = templateCards();
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <PageTitle title="Templates" description="A template sets the order and timing of scenes. How each scene looks still adapts to the product, tone and style. Save your own from any finished ad." />
      <div className="mb-5">
        <SceneLegend />
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-4">
        {templates.map((t) => {
          const aspects = [...new Set(t.platforms.map((p) => PLATFORMS[p as PlatformKey]?.aspect).filter(Boolean))];
          return (
            <li key={t.key} className="flex flex-col rounded-xl border border-line bg-panel p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{t.name}</h2>
                {t.builtin ? null : <Status tone="accent">Yours</Status>}
              </div>
              <p className="mt-1 text-[13px] text-ink-2">{t.description}</p>
              <div className="mt-4">
                <SceneStrip scenes={t.scenes} labels />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-3">
                <span className="flex items-center gap-1 text-ink-2">
                  {aspects.map((a) => (
                    <AspectGlyph key={a} aspect={a!} size={15} />
                  ))}
                </span>
                <span className="tabular">{t.lengths.join(" / ")}s</span>
                <span>{OUTRO_LABEL[t.defaultOutro] ?? t.defaultOutro}</span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <Link href={`/new?template=${t.key}`} className={buttonClass("secondary", "sm")}>
                  Use template
                  <IconArrowRight size={15} />
                </Link>
                {t.builtin ? null : <TemplateDelete templateKey={t.key} name={t.name} />}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
