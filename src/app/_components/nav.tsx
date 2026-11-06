"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconMonitor, IconMoon, IconSun } from "./icons";

const LINKS = [
  { href: "/", label: "Ads", match: (p: string) => p === "/" || p.startsWith("/ads") || p === "/new" },
  { href: "/brands", label: "Brands", match: (p: string) => p.startsWith("/brands") },
  { href: "/templates", label: "Templates", match: (p: string) => p.startsWith("/templates") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Studio" className="-mx-1 flex min-w-0 overflow-x-auto">
      {LINKS.map((l) => {
        const active = l.match(path);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex min-h-10 items-center rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3 ${active ? "text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            {l.label}
            {active ? <span aria-hidden className="absolute inset-x-2.5 -bottom-[9px] h-0.5 rounded-full bg-accent sm:inset-x-3" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "dark", dark: "light", light: "system" };
const LABEL: Record<Theme, string> = { system: "Theme: match system", dark: "Theme: dark", light: "Theme: light" };

/** Cycles system → dark → light. Stored in a cookie so the server renders the right theme (no flash). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    // Reflect the server-rendered choice once mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the DOM
    if (t === "light" || t === "dark") setTheme(t);
  }, []);
  const apply = () => {
    const next = NEXT[theme];
    setTheme(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    document.cookie = `pinpo-theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  const Icon = theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconMonitor;
  return (
    <button type="button" onClick={apply} aria-label={`${LABEL[theme]}. Change theme`} title={LABEL[theme]} className="grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink">
      <Icon size={18} />
    </button>
  );
}
