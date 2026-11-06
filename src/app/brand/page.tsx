import { getMasterBrand, brandRevisions } from "@/server/brand/master";
import { StudioHeader } from "../_components/header";
import { BrandEditor } from "../_components/brand-editor";

export const dynamic = "force-dynamic";

export default function BrandPage() {
  const brand = getMasterBrand();
  if (!brand) return <p className="p-8">The brand is set up when the worker first starts (npm run dev).</p>;
  const t = brand.tokens;
  const logo = brand.logos.find((l) => l.variant === "horizontal");
  const revisions = brandRevisions(brand.id);
  const typo = t.typography as { fontsTemporary?: boolean };
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8">
      <StudioHeader />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">DemandMesh brand</h1>
      <p className="mt-1 max-w-prose text-sm text-dm-secondary">The protected master brand every ad uses. Revision {brand.revisionNumber}.</p>

      <section aria-labelledby="logo-h" className="mt-8 grid gap-3">
        <h2 id="logo-h" className="text-lg font-bold">Logo</h2>
        {logo ? (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dm-border p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- official logo, exact file */}
            <img src={`/api/assets/${logo.assetId}`} alt="DemandMesh logo" width={logo.width ?? 304} height={logo.height ?? 62} />
            <p className="text-sm text-dm-secondary">
              Official file, {logo.width}×{logo.height}px, hash {logo.pinnedSha256.slice(0, 12)}… pinned.
              {logo.temporary ? " Temporary low-resolution logo — shown no larger than 1.25× its size. Replace it with the official high-res files." : ""}
            </p>
          </div>
        ) : null}
        <p className="text-sm text-dm-secondary">Icon and inverse (light-on-dark) logo variants aren&apos;t supplied yet, so outros use the logo on light backgrounds.</p>
      </section>

      <section aria-labelledby="colors-h" className="mt-8">
        <h2 id="colors-h" className="text-lg font-bold">Colours</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(t.colors)
            .filter(([k]) => !["white", "black"].includes(k))
            .map(([k, v]) => (
              <li key={k} className="overflow-hidden rounded-lg border border-dm-border">
                <div className="h-14" style={{ background: v }} />
                <p className="px-3 py-2 text-xs">
                  <span className="font-semibold">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                  <br />
                  <span className="text-dm-secondary">{v}</span>
                </p>
              </li>
            ))}
        </ul>
      </section>

      <section aria-labelledby="type-h" className="mt-8 grid gap-3">
        <h2 id="type-h" className="text-lg font-bold">Typography</h2>
        <div className="grid gap-2 rounded-xl border border-dm-border p-4">
          <p className="text-2xl font-bold">Buy together for less ₹1,299</p>
          <p lang="ml" className="text-2xl font-bold" style={{ fontFamily: "var(--font-pinpo)" }}>
            ഒരുമിച്ച് വാങ്ങൂ, കുറഞ്ഞ വിലയിൽ
          </p>
          <p lang="hi" className="text-2xl font-bold">
            साथ खरीदें, कम कीमत में
          </p>
          <p className="text-xs text-dm-secondary">{typo.fontsTemporary ? "Placeholder fonts (Noto Sans family, OFL) until DemandMesh's approved fonts are supplied." : "Approved fonts."}</p>
        </div>
      </section>

      <section aria-labelledby="copy-h" className="mt-8 grid gap-3">
        <h2 id="copy-h" className="text-lg font-bold">Brand copy</h2>
        <dl className="grid gap-1 text-sm">
          <div>
            <dt className="inline font-semibold">Website: </dt>
            <dd className="inline">{t.website}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Tagline: </dt>
            <dd className="inline">{t.tagline}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Instagram: </dt>
            <dd className="inline">{t.social.instagram}</dd>
          </div>
        </dl>
        <BrandEditor tagline={t.tagline} groupBuyLine={t.groupBuyLine ?? ""} approvedCtas={{ en: t.approvedCtas.en ?? [], ml: t.approvedCtas.ml ?? [], hi: t.approvedCtas.hi ?? [] }} instagram={t.social.instagram ?? ""} />
      </section>

      <section aria-labelledby="rev-h" className="mt-8">
        <h2 id="rev-h" className="text-lg font-bold">Revision history</h2>
        <ol className="mt-3 grid gap-2 text-sm">
          {revisions.map((r) => (
            <li key={r.id} className="rounded-lg border border-dm-border px-3 py-2">
              <span className="font-semibold">Revision {r.number}</span> · {new Date(r.created_at).toLocaleString("en-IN")} {r.note ? `· ${r.note}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
