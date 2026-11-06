"use client";

import { useEffect, useState } from "react";

interface Status {
  worker: { online: boolean; heartbeatAgeS: number | null; mockMode: boolean; falKeyConfigured: boolean; rendererVersion: string | null };
  renderer: { pinnedBuild: string; usingPinned: boolean | null };
  disk: { freeBytes: number; storageBytes: number };
  db: { ok: boolean };
  brand: { seeded: boolean; name: string | null; count: number; logoTemporary: boolean | null; fontsTemporary: boolean | null };
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

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
  if (!status) return <p className="text-sm text-ink-3" aria-busy="true">Checking…</p>;

  const rows: { label: string; value: string; ok: boolean }[] = [
    {
      label: "Worker",
      value: status.worker.online ? `Running (last heartbeat ${status.worker.heartbeatAgeS}s ago)` : "Offline — start it with `npm run dev`",
      ok: status.worker.online,
    },
    {
      label: "Video generation",
      value: status.worker.mockMode ? "Mock mode (no cost, test clips)" : status.worker.falKeyConfigured ? "fal.ai key configured" : "No fal.ai key — add FAL_KEY to .env.local",
      ok: status.worker.mockMode || status.worker.falKeyConfigured,
    },
    {
      label: "Brand renderer",
      value: status.worker.rendererVersion
        ? `${status.worker.rendererVersion}${status.renderer.usingPinned ? "" : ` — not the pinned ${status.renderer.pinnedBuild}; run npm run setup`}`
        : "Not ready — run `npm run setup`",
      ok: !!status.worker.rendererVersion && !!status.renderer.usingPinned,
    },
    { label: "Disk", value: `${gb(status.disk.freeBytes)} free · ${gb(status.disk.storageBytes)} used by studio`, ok: status.disk.freeBytes > 5 * 1024 ** 3 },
    { label: "Database", value: status.db.ok ? "Healthy" : "Integrity check failed — restore a backup", ok: status.db.ok },
    {
      label: "Brands",
      value: status.brand.count
        ? `${status.brand.count} brand${status.brand.count === 1 ? "" : "s"} · default: ${status.brand.name}${status.brand.logoTemporary ? " (low-res logo)" : ""}`
        : "No brands yet — add one on the Brands page",
      ok: status.brand.count > 0,
    },
  ];

  return (
    <dl className="divide-y divide-line rounded-lg border border-line">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
          <dt className="flex w-40 shrink-0 items-center gap-2 text-sm font-semibold">
            <span aria-hidden className={`inline-block size-2 rounded-full ${r.ok ? "bg-ok" : "bg-warn"}`} />
            {r.label}
            <span className="sr-only">{r.ok ? "(OK)" : "(needs attention)"}</span>
          </dt>
          <dd className="text-sm text-ink-2">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
