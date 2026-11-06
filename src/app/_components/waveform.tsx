"use client";

import { useEffect, useState } from "react";

/**
 * Waveform drawn from the audio file itself (decoded in the browser with Web Audio), so no server
 * work is needed. Peaks are cached per asset for the session.
 */
const cache = new Map<string, number[]>();

export function Waveform({ assetId, bars = 120, height = 40, label }: { assetId: string; bars?: number; height?: number; label: string }) {
  const [peaks, setPeaks] = useState<number[] | null>(cache.get(assetId) ?? null);

  useEffect(() => {
    if (cache.has(assetId)) return;
    let alive = true;
    void (async () => {
      try {
        const buf = await (await fetch(`/api/assets/${assetId}`)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 44_100);
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / bars));
        const out: number[] = [];
        for (let b = 0; b < bars; b++) {
          let max = 0;
          for (let i = b * step; i < Math.min(data.length, (b + 1) * step); i++) max = Math.max(max, Math.abs(data[i]!));
          out.push(max);
        }
        const top = Math.max(...out, 0.0001);
        const norm = out.map((v) => v / top);
        cache.set(assetId, norm);
        if (alive) setPeaks(norm);
      } catch {
        if (alive) setPeaks([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [assetId, bars]);

  if (!peaks) return <div className="h-10 animate-pulse rounded bg-dm-surface" aria-label={`Loading waveform: ${label}`} />;
  if (!peaks.length) return <p className="text-xs text-dm-secondary">Waveform unavailable</p>;
  const w = 2;
  const gap = 1;
  return (
    <svg role="img" aria-label={`Waveform: ${label}`} viewBox={`0 0 ${peaks.length * (w + gap)} ${height}`} preserveAspectRatio="none" className="h-10 w-full">
      {peaks.map((v, i) => {
        const h = Math.max(1, v * height);
        return <rect key={i} x={i * (w + gap)} y={(height - h) / 2} width={w} height={h} rx={1} fill="#526979" />;
      })}
    </svg>
  );
}
