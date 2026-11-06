"use client";

import { useEffect, useState } from "react";

export interface SettingsSection {
  id: string;
  label: string;
}

/**
 * Section menu for Settings: a sticky list on wide screens, wrapping chips on narrow ones.
 * Highlights the section in view (IntersectionObserver), so it doubles as a "you are here".
 */
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const visible = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        const best = sections.find((s) => (visible.get(s.id) ?? 0) > 0);
        if (best) setActive(best.id);
      },
      { rootMargin: "-80px 0px -55% 0px", threshold: [0, 0.01] },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
      <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "location" : undefined}
                onClick={() => setActive(s.id)}
                className={`flex min-h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${on ? "bg-panel-2 font-semibold text-ink" : "text-ink-2 hover:bg-panel-2/60 hover:text-ink"} max-lg:border max-lg:border-line ${on ? "max-lg:border-line-strong" : ""}`}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
