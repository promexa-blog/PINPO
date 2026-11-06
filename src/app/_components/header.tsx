import Link from "next/link";
import { getWorker, workerOnline } from "@/server/jobs/worker-lease";
import { IconFrames } from "./icons";
import { NavLinks, ThemeToggle } from "./nav";

/** Studio chrome: PINPO mark, primary nav, generation mode and theme. Customer brands never appear here. */
export function StudioHeader() {
  const w = getWorker();
  const online = workerOnline(w);
  const mode = !online ? { label: "Worker offline", tone: "bg-bad", title: "Start the studio with npm run dev — generation needs the worker." } : w?.mock_mode === 1 ? { label: "Mock mode", tone: "bg-warn", title: "Test clips only — nothing is charged. Set FAL_MOCK=0 and FAL_KEY in .env.local for real ads." } : { label: "fal.ai live", tone: "bg-ok", title: "Real generation with your fal.ai key." };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="PINPO Ad Studio — home">
          <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink">
            <IconFrames size={17} strokeWidth={2} />
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight sm:inline">PINPO</span>
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-1.5">
          <Link href="/settings" title={mode.title} className="hidden min-h-8 items-center gap-2 rounded-full border border-line px-2.5 text-xs font-semibold text-ink-2 hover:border-line-strong hover:text-ink md:inline-flex">
            <span aria-hidden className={`size-2 rounded-full ${mode.tone}`} />
            {mode.label}
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
