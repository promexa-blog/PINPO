import type { TemplateCard } from "@/server/planning/template-cards";

const KIND = {
  original: { cls: "bg-accent", label: "Your real product photo" },
  ai_product: { cls: "bg-ink-2", label: "AI video from your photo" },
  ai: { cls: "bg-line-strong", label: "AI scene" },
} as const;

/** A template's scenes as a proportional timeline strip (at a given ad length), plus the outro. */
export function SceneStrip({ scenes, lengthS = 30, labels = false }: { scenes: TemplateCard["scenes"]; lengthS?: number; labels?: boolean }) {
  const used = scenes.filter((s) => s.minLengthS <= lengthS);
  const total = used.reduce((a, s) => a + s.weight, 0) || 1;
  return (
    <div>
      <ol className="flex h-2.5 gap-[3px]" aria-label={`${used.length} scenes, then the outro`}>
        {used.map((s, i) => (
          <li key={i} className={`relative rounded-[3px] ${KIND[s.kind].cls}`} style={{ flexGrow: s.weight / total }} title={`${s.label} · ${KIND[s.kind].label}`}>
            <span className="sr-only">
              {s.label} ({KIND[s.kind].label})
            </span>
          </li>
        ))}
        <li className="relative w-4 shrink-0 rounded-[3px] border border-ink-3" title="Outro with your logo">
          <span className="sr-only">Outro</span>
        </li>
      </ol>
      {labels ? (
        <ol className="mt-3 grid gap-1.5 text-[13px]">
          {used.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className={`size-2 shrink-0 rounded-[2px] ${KIND[s.kind].cls}`} />
              <span className="min-w-0 truncate">{s.label}</span>
              <span className="ml-auto shrink-0 text-xs text-ink-3">{KIND[s.kind].label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function SceneLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {Object.values(KIND).map((k) => (
        <li key={k.label} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2 rounded-[2px] ${k.cls}`} />
          {k.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-[2px] border border-ink-3" />
        Outro with your logo
      </li>
    </ul>
  );
}
