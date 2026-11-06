import Link from "next/link";

export function StudioHeader({ crumb }: { crumb?: { href: string; label: string } }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-dm-border py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex items-center gap-3" aria-label="PINPO Ad Studio — all ads">
          <span className="font-bold">PINPO</span>
          <span className="hidden text-sm text-dm-secondary sm:inline">Ad Studio</span>
        </Link>
        {crumb ? (
          <>
            <span aria-hidden className="text-dm-border">
              /
            </span>
            <Link href={crumb.href} className="truncate text-sm font-semibold hover:underline">
              {crumb.label}
            </Link>
          </>
        ) : null}
      </div>
      <nav aria-label="Studio" className="flex gap-1 text-sm">
        {[
          ["/", "Ads"],
          ["/brand", "Brand"],
          ["/templates", "Templates"],
          ["/settings", "Settings"],
        ].map(([href, label]) => (
          <Link key={href} href={href!} className="min-h-11 content-center rounded-lg px-3 font-semibold hover:bg-dm-surface">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
