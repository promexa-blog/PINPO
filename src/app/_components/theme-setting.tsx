"use client";

import { setStudioTheme, useStudioTheme, type Theme } from "./nav";
import { IconCheck, IconMonitor, IconMoon, IconSun } from "./icons";

const OPTIONS: { value: Theme; label: string; hint: string; icon: typeof IconSun }[] = [
  { value: "system", label: "Match system", hint: "Follows your computer's setting", icon: IconMonitor },
  { value: "dark", label: "Dark", hint: "Best for judging footage", icon: IconMoon },
  { value: "light", label: "Light", hint: "For bright rooms", icon: IconSun },
];

export function ThemeSetting() {
  const theme = useStudioTheme();
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const sel = o.value === theme;
          const Icon = o.icon;
          return (
            <label key={o.value} className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${sel ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}>
              <input type="radio" name="theme" value={o.value} checked={sel} onChange={() => setStudioTheme(o.value)} className="sr-only" />
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${sel ? "bg-accent text-accent-ink" : "bg-panel-2 text-ink-2"}`}>
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-ink-3">{o.hint}</span>
              </span>
              {sel ? (
                <span aria-hidden className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-accent text-accent-ink">
                  <IconCheck size={12} strokeWidth={2.5} />
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
