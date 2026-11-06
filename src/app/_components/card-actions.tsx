"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCopy, IconTrash } from "./icons";

export function CardActions({ adId, name }: { adId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<Response>, after: (r: Response) => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(b.error?.message ?? "That didn't work. Try again.");
        return;
      }
      await after(r);
    } finally {
      setBusy(false);
    }
  };
  const btn = "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
      <button type="button" disabled={busy} className={btn} aria-label={`Duplicate ${name}`} onClick={() => run(() => fetch(`/api/ads/${adId}/duplicate`, { method: "POST" }), async (r) => router.push(`/ads/${((await r.json()) as { adId: string }).adId}/edit`))}>
        <IconCopy size={15} />
        Duplicate
      </button>
      <button
        type="button"
        disabled={busy}
        className={btn}
        aria-label={`Delete ${name}`}
        onClick={() => {
          if (window.confirm(`Delete "${name}"?\n\nIt disappears from your library now and is removed for good, with its videos, after 7 days.`)) void run(() => fetch(`/api/ads/${adId}`, { method: "DELETE" }), () => router.refresh());
        }}
      >
        <IconTrash size={15} />
        Delete
      </button>
      {error ? (
        <p role="alert" className="w-full px-2 pb-1 text-xs font-semibold text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
