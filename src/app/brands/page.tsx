import Link from "next/link";
import { getBrand, listBrands } from "@/server/brand/kits";
import { BrandPreview } from "../_components/brand-preview";
import { PageTitle, Status, buttonClass } from "../_components/ui";
import { IconPlus } from "../_components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brands" };

export default function BrandsPage() {
  const brands = listBrands();
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <PageTitle
        title="Brands"
        description="Each brand's colours, logo and website are used for the text, buttons and ending of its ads. The default brand is picked for new ads."
        actions={
          <Link href="/brands/new" className={buttonClass("primary")}>
            <IconPlus size={17} />
            New brand
          </Link>
        }
      />
      {brands.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-panel px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">No brands yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">Add your brand once — name, website, two colours and a logo — and every ad uses it.</p>
          <Link href="/brands/new" className={`${buttonClass("primary")} mt-5`}>
            <IconPlus size={17} />
            Add a brand
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-4">
          {brands.map((b) => {
            const full = getBrand(b.id)!;
            const logo = full.logos[0];
            return (
              <li key={b.id}>
                <Link href={`/brands/${b.id}`} className="group flex h-full gap-4 rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line-strong">
                  <BrandPreview
                    show="outro"
                    width={96}
                    brand={{ name: b.name, website: b.website, tagline: b.tagline, colors: full.tokens.colors, logo: logo ? { src: `/api/assets/${logo.assetId}`, width: logo.width ?? 300, height: logo.height ?? 100 } : null, cta: full.tokens.approvedCtas.en?.[0] ?? "" }}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold group-hover:underline">{b.name}</h2>
                      {b.isDefault ? <Status tone="accent">Default</Status> : null}
                    </div>
                    <p className="truncate text-sm text-ink-2">{b.website}</p>
                    {b.tagline ? <p className="line-clamp-2 text-[13px] text-ink-3">{b.tagline}</p> : null}
                    <div className="mt-auto flex items-center gap-3 pt-2">
                      <span aria-hidden className="flex overflow-hidden rounded ring-1 ring-line">
                        <span className="h-5 w-6" style={{ background: b.primary }} />
                        <span className="h-5 w-4" style={{ background: b.secondary }} />
                      </span>
                      <span className="tabular text-xs text-ink-3">
                        {b.adCount} ad{b.adCount === 1 ? "" : "s"} · revision {b.revisionNumber}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
