import Link from "next/link";
import { notFound } from "next/navigation";
import { brandRevisions, getBrand, listBrands } from "@/server/brand/kits";
import { BrandForm, type BrandFormValues } from "../../_components/brand-form";
import { BrandActions } from "../../_components/brand-actions";
import { Status } from "../../_components/ui";
import { IconArrowLeft } from "../../_components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brand" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summary = listBrands().find((b) => b.id === id);
  const brand = summary ? getBrand(id) : undefined;
  if (!brand || !summary) notFound();
  const t = brand.tokens;
  const logo = brand.logos[0];
  const initial: BrandFormValues = {
    name: t.name,
    website: t.website,
    tagline: t.tagline,
    primary: t.colors.primary ?? "#000000",
    secondary: t.colors.secondary ?? "#000000",
    logo: logo ? { assetId: logo.assetId, width: logo.width ?? 300, height: logo.height ?? 100 } : null,
    ctas: { en: (t.approvedCtas.en ?? []).join("\n"), ml: (t.approvedCtas.ml ?? []).join("\n"), hi: (t.approvedCtas.hi ?? []).join("\n") },
    groupBuyLine: t.groupBuyLine ?? "",
    instagram: t.social.instagram ?? "",
  };
  const revisions = brandRevisions(id);
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <Link href="/brands" className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <IconArrowLeft size={16} />
        Brands
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[1.625rem] font-semibold tracking-tight">{t.name}</h1>
            {brand.isDefault ? <Status tone="accent">Default</Status> : null}
          </div>
          <p className="tabular mt-1 text-sm text-ink-2">
            Revision {brand.revisionNumber} · {summary.adCount} ad{summary.adCount === 1 ? "" : "s"}
          </p>
        </div>
        <BrandActions brandId={id} name={t.name} isDefault={brand.isDefault} />
      </div>
      <BrandForm key={brand.revisionId} mode="edit" brandId={id} initial={initial} />
      <section aria-labelledby="rev-h" className="mt-10 max-w-3xl">
        <h2 id="rev-h" className="text-base font-semibold">
          Revision history
        </h2>
        <ol className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel">
          {revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <span>
                <span className="tabular font-semibold">Revision {r.number}</span>
                {r.note ? <span className="text-ink-2"> · {r.note}</span> : null}
              </span>
              <time className="tabular text-xs text-ink-3" dateTime={new Date(r.created_at).toISOString()}>
                {new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
