"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconMenu, IconMonitor, IconMoon, IconSun, IconX } from "./icons";

const LINKS = [
  { href: "/", label: "Ads", match: (p: string) => p === "/" || p.startsWith("/ads") || p === "/new" },
  { href: "/brands", label: "Brands", match: (p: string) => p.startsWith("/brands") },
  { href: "/templates", label: "Templates", match: (p: string) => p.startsWith("/templates") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export interface StudioMode {
  label: string;
  dot: string;
  title: string;
}

/** Desktop primary navigation: full-height links, active underline on the header's bottom edge. */
export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="hidden h-full items-stretch md:flex">
      <ul className="flex h-full items-stretch gap-1">
        {LINKS.map((l) => {
          const active = l.match(path);
          return (
            <li key={l.href} className="flex">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-offset-[-4px] ${active ? "text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
                <span aria-hidden className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full transition-colors duration-150 ${active ? "bg-accent" : "bg-transparent"}`} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Narrow screens: a menu button that opens the same links as a panel under the header. */
export function MobileMenu({ mode }: { mode: StudioMode }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink"
      >
        {open ? <IconX size={20} /> : <IconMenu size={20} />}
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 top-14 z-30 cursor-default bg-black/40" onClick={() => setOpen(false)} />
          <nav id="mobile-nav" aria-label="Main" className="menu-enter absolute inset-x-0 top-full z-40 border-b border-line bg-canvas px-4 pb-4 pt-2 shadow-lift">
            <ul className="grid gap-1">
              {LINKS.map((l) => {
                const active = l.match(path);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center justify-between rounded-lg px-3 text-[15px] font-medium transition-colors ${active ? "bg-panel-2 text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink"}`}
                    >
                      {l.label}
                      {active ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-center gap-2 border-t border-line px-3 pt-3 text-[13px] text-ink-2">
              <span aria-hidden className={`size-2 rounded-full ${mode.dot}`} />
              {mode.label}
              <span className="text-ink-3">— {mode.title}</span>
            </p>
          </nav>
        </>
      ) : null}
    </div>
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
