import Link from "next/link";
import { getWorker, workerOnline } from "@/server/jobs/worker-lease";
import { IconFrames } from "./icons";
import { MobileMenu, NavLinks, ThemeToggle, type StudioMode } from "./nav";

/** Studio chrome: PINPO mark, primary nav, generation mode and theme. Customer brands never appear here. */
export function StudioHeader() {
  const w = getWorker();
  const online = workerOnline(w);
  const mode: StudioMode = !online
    ? { label: "Worker offline", dot: "bg-bad", title: "Start the studio with npm run dev — generation needs the worker." }
    : w?.mock_mode === 1
      ? { label: "Mock mode", dot: "bg-warn", title: "Test clips only — nothing is charged." }
      : { label: "fal.ai live", dot: "bg-ok", title: "Real generation with your fal.ai key." };
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="relative mx-auto flex h-14 max-w-7xl items-stretch gap-8 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 self-center rounded-md" aria-label="PINPO Ad Studio — home">
          <span className="grid size-7 place-items-center rounded-[7px] bg-accent text-accent-ink">
            <IconFrames size={17} strokeWidth={2} />
          </span>
          <span className="text-[15px] font-bold tracking-tight">PINPO</span>
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/settings"
            title={mode.title}
            className="hidden h-8 items-center gap-2 rounded-full border border-line px-3 text-xs font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
          >
            <span aria-hidden className={`size-2 rounded-full ${mode.dot}`} />
            {mode.label}
          </Link>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <ThemeToggle />
          <MobileMenu mode={mode} />
        </div>
      </div>
    </header>
  );
}
