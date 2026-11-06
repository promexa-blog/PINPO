"use client";

import { useEffect, useState } from "react";

interface Status {
  worker: { online: boolean; heartbeatAgeS: number | null; mockMode: boolean; falKeyConfigured: boolean; rendererVersion: string | null };
  renderer: { pinnedBuild: string; usingPinned: boolean | null };
  disk: { freeBytes: number; storageBytes: number };
  db: { ok: boolean };
  brand: { seeded: boolean; name: string | null; count: number; logoTemporary: boolean | null; fontsTemporary: boolean | null };
}

const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

export function SystemStatusPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/system/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`Status request failed (${res.status})`);
        const data = (await res.json()) as Status;
        if (alive) {
          setStatus(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Status unavailable");
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <p className="text-sm text-bad">Couldn&apos;t load status: {error}</p>;
  if (!status)
    return (
      <div aria-busy="true" aria-label="Checking studio status" className="grid animate-pulse gap-px overflow-hidden rounded-xl border border-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-14 bg-panel-2/60" />
        ))}
      </div>
    );

  const rows: { label: string; value: string; ok: boolean }[] = [
    {
      label: "Background worker",
      value: status.worker.online ? `Running · last heartbeat ${status.worker.heartbeatAgeS}s ago` : "Offline — start the studio with npm run dev",
      ok: status.worker.online,
    },
    {
      label: "Video generation",
      value: status.worker.mockMode ? "Mock mode — test clips, nothing is charged" : status.worker.falKeyConfigured ? "fal.ai key configured — real generation" : "No fal.ai key — add FAL_KEY to .env.local",
      ok: status.worker.mockMode || status.worker.falKeyConfigured,
    },
    {
      label: "Graphics renderer",
      value: status.worker.rendererVersion
        ? `${status.worker.rendererVersion.replace("HeadlessChrome/", "Chrome ")}${status.renderer.usingPinned ? " (pinned)" : ` — not the pinned ${status.renderer.pinnedBuild}; run npm run setup`}`
        : "Not ready — run npm run setup",
      ok: !!status.worker.rendererVersion && !!status.renderer.usingPinned,
    },
    { label: "Disk space", value: `${gb(status.disk.freeBytes)} free · ${gb(status.disk.storageBytes)} used by the studio`, ok: status.disk.freeBytes > 5 * 1024 ** 3 },
    { label: "Database", value: status.db.ok ? "Healthy" : "Integrity check failed — restore a backup", ok: status.db.ok },
    {
      label: "Brands",
      value: status.brand.count ? `${status.brand.count} brand${status.brand.count === 1 ? "" : "s"} · default: ${status.brand.name}${status.brand.logoTemporary ? " (low-res logo)" : ""}` : "No brands yet — add one on the Brands page",
      ok: status.brand.count > 0,
    },
  ];

  return (
    <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[11rem_1fr_auto] sm:items-center sm:gap-4">
          <dt className="text-sm font-semibold">{r.label}</dt>
          <dd className="text-sm text-ink-2">{r.value}</dd>
          <dd className="sm:justify-self-end">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${r.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {r.ok ? "OK" : "Needs attention"}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
