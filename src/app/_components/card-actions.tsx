"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CardActions({ adId, name }: { adId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<Response>, after: (r: Response) => Promise<void> | void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        window.alert(b.error?.message ?? "That didn't work.");
        return;
      }
      await after(r);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-1 px-4 pb-3">
      <button
        type="button"
        disabled={busy}
        className="min-h-11 rounded-lg px-3 text-xs font-semibold hover:bg-dm-surface"
        onClick={() => run(() => fetch(`/api/ads/${adId}/duplicate`, { method: "POST" }), async (r) => router.push(`/ads/${((await r.json()) as { adId: string }).adId}/edit`))}
      >
        Duplicate
      </button>
      <button
        type="button"
        disabled={busy}
        className="min-h-11 rounded-lg px-3 text-xs font-semibold hover:bg-dm-surface"
        onClick={() => {
          if (window.confirm(`Delete "${name}"? It's kept for 7 days, then removed with its videos.`)) void run(() => fetch(`/api/ads/${adId}`, { method: "DELETE" }), () => router.refresh());
        }}
      >
        Delete
      </button>
    </div>
  );
}
