import Link from "next/link";
import { listBrands } from "@/server/brand/kits";
import { listAds } from "@/server/db/repos/versions";
import { PLATFORMS } from "@/lib/platforms";
import { now as nowMs } from "@/server/util";
import { AdCard, type AdCardData } from "./_components/ad-card";
import { PageTitle, buttonClass, type Tone } from "./_components/ui";
import { IconFrames, IconPlus, IconSearch } from "./_components/icons";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: Tone; group: string }> = {
  draft: { label: "Draft", tone: "neutral", group: "draft" },
  queued: { label: "Queued", tone: "accent", group: "working" },
  generating: { label: "Generating", tone: "accent", group: "working" },
  composing: { label: "Editing", tone: "accent", group: "working" },
  ready: { label: "Ready", tone: "ok", group: "ready" },
  failed: { label: "Needs attention", tone: "bad", group: "attention" },
  canceled: { label: "Canceled", tone: "neutral", group: "attention" },
};
const FILTERS = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "working", label: "In progress" },
  { key: "ready", label: "Ready" },
  { key: "attention", label: "Needs attention" },
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(ms: number, now: number): string {
  const s = Math.round((ms - now) / 1000);
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
  return "";
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = "", status = "" } = await searchParams;
  const brands = listBrands();
  const all = listAds();
  const now = nowMs();
  const count = (g: string) => (g ? all.filter((a) => STATUS[a.status]?.group === g).length : all.length);
  const ads = all.filter((a) => (!q || a.name.toLowerCase().includes(q.toLowerCase())) && (!status || STATUS[a.status]?.group === status));
  const cards: AdCardData[] = ads.map((a) => {
    const p = PLATFORMS[a.platform];
    return {
      id: a.id,
      name: a.name,
      href: a.status === "draft" ? `/ads/${a.id}/edit` : `/ads/${a.id}`,
      aspect: p.aspect,
      platformLabel: p.label,
      lengthS: (JSON.parse(a.settings_json) as { lengthS: number }).lengthS,
      version: a.number,
      versions: a.version_count,
      status: STATUS[a.status] ?? { label: a.status, tone: "neutral" },
      brandName: brands.length > 1 ? a.brand_name : null,
      updated: `Edited ${ago(a.updated_at, now)}`,
      thumbId: a.thumb_asset_id,
      videoId: a.status === "ready" ? a.final_asset_id : null,
      productId: a.product_asset_id,
    };
  });
  const filterHref = (key: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (key) sp.set("status", key);
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <PageTitle
        title="Ads"
        description={all.length ? `${all.length} ad${all.length === 1 ? "" : "s"}, newest first. Hover a finished ad to play it.` : undefined}
        actions={
          brands.length ? (
            <Link href="/new" className={buttonClass("primary")}>
              <IconPlus size={17} />
              New ad
            </Link>
          ) : null
        }
      />

      {all.length === 0 ? (
        <section aria-labelledby="empty-h" className="grid place-items-center rounded-2xl border border-dashed border-line-strong bg-panel px-6 py-16 text-center">
          <span className="grid size-14 place-items-center rounded-xl bg-accent-soft text-accent-text">
            <IconFrames size={30} strokeWidth={1.5} />
          </span>
          <h2 id="empty-h" className="mt-5 text-xl font-semibold tracking-tight">
            {brands.length ? "Make your first ad" : "Start with your brand"}
          </h2>
          <p className="mt-2 max-w-md text-sm text-ink-2">
            {brands.length
              ? "Pick a template and a format, add a product photo and a few true benefits. PINPO plans the scenes, generates them and adds your brand."
              : "Add your brand's name, colours and logo once. Every ad you make uses them for its text, buttons and closing frame."}
          </p>
          <Link href={brands.length ? "/new" : "/brands/new"} className={`${buttonClass("primary")} mt-6`}>
            <IconPlus size={17} />
            {brands.length ? "New ad" : "Add a brand"}
          </Link>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-center lg:justify-between">
            <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto">
              {FILTERS.map((f) => {
                const active = status === f.key;
                return (
                  <Link key={f.key} href={filterHref(f.key)} aria-current={active ? "page" : undefined} className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-panel-2 text-ink ring-1 ring-line-strong" : "text-ink-2 hover:bg-panel-2 hover:text-ink"}`}>
                    {f.label}
                    <span className={`tabular text-xs ${active ? "text-accent-text" : "text-ink-3"}`}>{count(f.key)}</span>
                  </Link>
                );
              })}
            </nav>
            <form role="search" className="relative w-full lg:w-72">
              {status ? <input type="hidden" name="status" value={status} /> : null}
              <label htmlFor="ad-search" className="sr-only">
                Search ads by name
              </label>
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input id="ad-search" name="q" type="search" defaultValue={q} placeholder="Search by name" className="min-h-10 w-full rounded-lg border border-line bg-sunken pl-9 pr-3 text-sm placeholder:text-ink-3 hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35" />
            </form>
          </div>

          {cards.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-semibold">No ads match {q ? `"${q}"` : "this filter"}.</p>
              <Link href="/" className="mt-2 inline-block text-sm font-semibold text-accent-text hover:underline">
                Show all ads
              </Link>
            </div>
          ) : (
            <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-4" aria-label="Your ads">
              {cards.map((c) => (
                <AdCard key={c.id} ad={c} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
