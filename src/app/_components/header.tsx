import Link from "next/link";
import { getMasterBrand } from "@/server/brand/master";

export function StudioHeader({ crumb }: { crumb?: { href: string; label: string } }) {
  const brand = getMasterBrand();
  const logo = brand?.logos.find((l) => l.variant === "horizontal");
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-dm-border py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex items-center gap-3" aria-label="DemandMesh Ad Studio — all ads">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- official logo, exact file
            <img src={`/api/assets/${logo.assetId}`} alt="DemandMesh" width={logo.width ?? 152} height={logo.height ?? 31} className="h-6 w-auto" />
          ) : (
            <span className="font-bold">DemandMesh</span>
          )}
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
