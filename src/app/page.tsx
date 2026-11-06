import Link from "next/link";
import { getMasterBrand } from "@/server/brand/master";
import { listAds } from "@/server/db/repos/versions";
import { db } from "@/server/db";
import { seedTemplates } from "@/server/planning/templates";
import { PLATFORMS } from "@/lib/platforms";
import { SystemStatusPanel } from "@/components/status/system-status";
import { NewAdForm } from "./_components/new-ad-form";
import { StudioHeader } from "./_components/header";
import { CardActions } from "./_components/card-actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  queued: "Queued",
  generating: "Generating",
  composing: "Composing",
  ready: "Ready",
  failed: "Needs attention",
  canceled: "Canceled",
};

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = "", status = "" } = await searchParams;
  seedTemplates();
  const brand = getMasterBrand();
  const all = brand ? listAds() : [];
  const ads = all.filter((a) => (!q || a.name.toLowerCase().includes(q.toLowerCase())) && (!status || a.status === status));
  const templates = (db().prepare("SELECT key, name, description, platforms_json FROM templates ORDER BY builtin DESC, name").all() as { key: string; name: string; description: string; platforms_json: string }[]).map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    platforms: JSON.parse(t.platforms_json) as string[],
  }));

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <StudioHeader />
      <main className="flex-1 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ads</h1>
            <p className="mt-1 text-sm text-dm-secondary">Every DemandMesh ad you&apos;ve made, newest first.</p>
          </div>
        </div>

        <section aria-labelledby="new-ad" className="mt-6">
          <h2 id="new-ad" className="sr-only">
            New ad
          </h2>
          {brand ? <NewAdForm templates={templates} /> : <p className="rounded-xl border border-dm-border bg-dm-surface p-4 text-sm">Start the studio with <code>npm run dev</code> — the worker sets up the DemandMesh brand on first run.</p>}
        </section>

        <form className="mt-8 flex flex-wrap items-end gap-3" role="search">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Search
            <input name="q" defaultValue={q} placeholder="Ad name" className="min-h-11 rounded-lg border border-dm-border px-3 text-sm font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Status
            <select name="status" defaultValue={status} className="min-h-11 rounded-lg border border-dm-border px-3 text-sm font-normal">
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-lg border border-dm-border px-4 text-sm font-semibold hover:bg-dm-surface">
            Filter
          </button>
          {q || status ? (
            <Link href="/" className="min-h-11 content-center text-sm underline-offset-4 hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        <section aria-labelledby="ad-list" className="mt-6">
          <h2 id="ad-list" className="sr-only">
            Your ads
          </h2>
          {ads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-dm-border p-8 text-center text-sm text-dm-secondary">{all.length ? "No ads match this filter." : "No ads yet. Name your first one above and pick a template."}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ads.map((a) => (
                <li key={a.id} className="flex flex-col overflow-hidden rounded-xl border border-dm-border bg-dm-bg">
                  <Link href={a.status === "draft" ? `/ads/${a.id}/edit` : `/ads/${a.id}`} className="group flex flex-1 flex-col transition-colors hover:bg-dm-surface">
                    <div className="flex aspect-video max-h-56 items-center justify-center overflow-hidden bg-dm-surface">
                      {a.thumb_asset_id ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/assets/${a.thumb_asset_id}`} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-xs text-dm-secondary">{a.status === "draft" ? "Draft — not generated yet" : "No preview yet"}</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <p className="font-semibold group-hover:underline">{a.name}</p>
                      <p className="text-xs text-dm-secondary">
                        {PLATFORMS[a.platform].label} · {(JSON.parse(a.settings_json) as { lengthS: number }).lengthS}s · v{a.number}
                        {a.version_count > 1 ? ` of ${a.version_count}` : ""}
                      </p>
                      <p className="mt-auto text-xs font-semibold">{STATUS_LABEL[a.status] ?? a.status}</p>
                    </div>
                  </Link>
                  <CardActions adId={a.id} name={a.name} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className="mt-10">
          <summary className="cursor-pointer text-sm font-semibold">Studio status</summary>
          <SystemStatusPanel />
        </details>
      </main>
    </div>
  );
}
