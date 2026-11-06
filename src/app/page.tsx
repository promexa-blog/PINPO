import Link from "next/link";
import { getMasterBrand } from "@/server/brand/master";
import { listAds } from "@/server/db/repos/versions";
import { db } from "@/server/db";
import { seedTemplates } from "@/server/planning/templates";
import { PLATFORMS } from "@/lib/platforms";
import { SystemStatusPanel } from "@/components/status/system-status";
import { NewAdForm } from "./_components/new-ad-form";
import { StudioHeader } from "./_components/header";

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

export default function LibraryPage() {
  seedTemplates();
  const brand = getMasterBrand();
  const ads = brand ? listAds() : [];
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

        <section aria-labelledby="ad-list" className="mt-8">
          <h2 id="ad-list" className="sr-only">
            Your ads
          </h2>
          {ads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-dm-border p-8 text-center text-sm text-dm-secondary">No ads yet. Name your first one above and pick a template.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ads.map((a) => (
                <li key={a.id}>
                  <Link href={a.status === "draft" ? `/ads/${a.id}/edit` : `/ads/${a.id}`} className="group flex h-full flex-col overflow-hidden rounded-xl border border-dm-border bg-dm-bg transition-colors hover:border-dm-primary">
                    <div className="flex aspect-video items-center justify-center bg-dm-surface">
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
