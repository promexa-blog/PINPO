"use client";

import { useEffect, useRef, useState } from "react";
import type { SceneEdit } from "@/lib/version";
import type { BrandColors } from "@/lib/brand-layout/tokens";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { FramePreview } from "./frame-preview";
import { BrandPreview } from "./brand-preview";
import { Button } from "./ui";
import { IconPause, IconPlay, IconRefresh, IconX } from "./icons";

const OUTRO_S = 3;

export interface TimelineBrand {
  name: string;
  website: string;
  tagline: string;
  logo: { assetId: string; width: number; height: number } | null;
}

interface Props {
  scenes: SceneEdit[];
  platform: PlatformKey;
  colors: BrandColors;
  lang: "en" | "ml" | "hi";
  brand: TimelineBrand;
  cta: string;
  onMove: (from: number, to: number) => void;
  onJump: (index: number) => void;
}

/**
 * Storyboard timeline: one block per scene, width proportional to its time, plus the ending.
 * Drag to reorder; keyboard users focus a block and press Alt+←/→ (WCAG 2.5.7 alternative).
 */
export function StoryboardTimeline({ scenes, platform, colors, lang, brand, cta, onMove, onJump }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const p = PLATFORMS[platform];
  const thumbH = 64;
  const thumbW = Math.round((thumbH * p.width) / p.height);
  const total = scenes.reduce((a, s) => a + s.durationS, 0) + OUTRO_S;

  return (
    <section aria-labelledby="timeline-h" className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="timeline-h" className="text-sm font-semibold">
            Timeline <span className="tabular font-normal text-ink-2">· {total.toFixed(1)}s with the ending</span>
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">Drag scenes to reorder, or focus one and press Alt + ← / →. Select a scene to edit it.</p>
        </div>
        <Button variant="secondary" onClick={() => setPreviewing(true)}>
          <IconPlay size={15} />
          Preview
        </Button>
      </div>

      <ol aria-label="Scene order" className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {scenes.map((s, i) => {
          const lines = s.overlay.byLang[lang] ?? [];
          return (
            <li
              key={`${s.role}-${i}`}
              draggable
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== i) setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                if (!Number.isNaN(from)) onMove(from, i);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              className={`relative flex min-w-[5.5rem] transition-opacity duration-150 ${drag === i ? "opacity-40" : ""}`}
              style={{ flexGrow: s.durationS, flexBasis: 0 }}
            >
              <button
                type="button"
                onClick={() => onJump(i)}
                onKeyDown={(e) => {
                  if (!e.altKey) return;
                  if (e.key === "ArrowLeft" && i > 0) {
                    e.preventDefault();
                    onMove(i, i - 1);
                  } else if (e.key === "ArrowRight" && i < scenes.length - 1) {
                    e.preventDefault();
                    onMove(i, i + 1);
                  }
                }}
                aria-label={`Scene ${i + 1}: ${s.label}, ${s.durationS} seconds. Alt plus arrow keys to move.`}
                className={`flex w-full cursor-grab flex-col items-center gap-1.5 rounded-lg border bg-panel-2/50 px-2 pb-2 pt-2.5 transition-colors duration-150 hover:border-line-strong active:cursor-grabbing ${over === i && drag !== null && drag !== i ? "border-accent ring-2 ring-accent/30" : "border-line"}`}
              >
                <FramePreview platform={platform} colors={colors} lang={lang} layout={s.overlay.layout} lines={lines} productSrc={s.productAssetId ? `/api/assets/${s.productAssetId}` : null} aiScene={s.sceneType !== "product_original"} width={thumbW} caption={null} guides={false} />
                <span className="flex w-full items-center justify-center gap-1.5 text-xs font-semibold">
                  {s.sceneType === "product_original" ? <span aria-hidden title="Your real product photo" className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                  <span className="truncate">
                    <span className="tabular text-ink-3">{i + 1}</span> {s.label}
                  </span>
                </span>
                <span className="tabular text-[11px] text-ink-3">{s.durationS}s</span>
              </button>
            </li>
          );
        })}
        <li className="flex min-w-[4.5rem]" style={{ flexGrow: OUTRO_S, flexBasis: 0 }}>
          <div className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong px-2 py-2 text-center">
            <span className="text-xs font-semibold">Ending</span>
            <span className="tabular text-[11px] text-ink-3">{OUTRO_S}s · {brand.name}</span>
          </div>
        </li>
      </ol>

      {previewing ? <Animatic scenes={scenes} platform={platform} colors={colors} lang={lang} brand={brand} cta={cta} onClose={() => setPreviewing(false)} /> : null}
    </section>
  );
}

/** Silent playback of the storyboard at its real timing: frames as they'll be laid out, then the ending. */
function Animatic({ scenes, platform, colors, lang, brand, cta, onClose }: Omit<Props, "onMove" | "onJump"> & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const p = PLATFORMS[platform];
  const steps = [...scenes.map((s) => s.durationS), OUTRO_S];
  const total = steps.reduce((a, b) => a + b, 0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const clock = useRef(0);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const loop = (now: number) => {
      if (last !== null) {
        clock.current = Math.min(total, clock.current + (now - last) / 1000);
        setT(clock.current);
        if (clock.current >= total) {
          setPlaying(false);
          return;
        }
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // Stop at the end (derived each render; no effect needed to read the clock).
  const ended = t >= total;
  let acc = 0;
  let index = 0;
  for (; index < steps.length; index++) {
    if (t < acc + steps[index]! || index === steps.length - 1) break;
    acc += steps[index]!;
  }
  const isOutro = index === scenes.length;
  const scene = scenes[index];
  const stageH = Math.min(520, typeof window === "undefined" ? 520 : window.innerHeight - 220);
  const width = Math.round(Math.min(p.aspect === "16:9" ? 640 : 999, (stageH * p.width) / p.height));

  return (
    <dialog
      ref={ref}
      aria-label="Storyboard preview"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === " " && (e.target as HTMLElement).tagName !== "BUTTON") {
          e.preventDefault();
          setPlaying((x) => !x);
        }
      }}
      className="dialog-enter m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl rounded-2xl border border-line bg-panel p-0 text-ink shadow-lift backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Storyboard preview</h2>
          <p className="text-xs text-ink-3">Silent, with your real timing and text. AI scenes show as placeholders until they&apos;re generated.</p>
        </div>
        <button type="button" aria-label="Close preview" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-panel-2 hover:text-ink">
          <IconX size={18} />
        </button>
      </div>
      <div className="grid place-items-center bg-frame px-4 py-5">
        <div key={index} className="frame-fade" aria-live="polite">
          {isOutro || !scene ? (
            <BrandPreview show="outro" width={width} brand={{ name: brand.name, website: brand.website, tagline: brand.tagline, colors: colors as unknown as Record<string, string>, logo: brand.logo ? { src: `/api/assets/${brand.logo.assetId}`, width: brand.logo.width, height: brand.logo.height } : null, cta }} />
          ) : (
            <FramePreview platform={platform} colors={colors} lang={lang} layout={scene.overlay.layout} lines={scene.overlay.byLang[lang] ?? []} productSrc={scene.productAssetId ? `/api/assets/${scene.productAssetId}` : null} aiScene={scene.sceneType !== "product_original"} width={width} caption={`${index + 1} · ${scene.label}`} guides={false} />
          )}
        </div>
      </div>
      <div className="grid gap-3 border-t border-line px-4 py-3">
        <div className="flex h-1.5 gap-[2px]" role="progressbar" aria-label="Preview position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)}>
          {steps.map((d, i) => {
            const start = steps.slice(0, i).reduce((a, b) => a + b, 0);
            const fill = Math.max(0, Math.min(1, (t - start) / d));
            return (
              <div key={i} className="relative overflow-hidden rounded-full bg-panel-2" style={{ flexGrow: d, flexBasis: 0 }}>
                <div className={`absolute inset-y-0 left-0 ${i === scenes.length ? "bg-ink-2" : "bg-accent"}`} style={{ width: `${fill * 100}%` }} />
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            {ended ? (
              <Button
                onClick={() => {
                  clock.current = 0;
                  setT(0);
                  setPlaying(true);
                }}
              >
                <IconRefresh size={15} />
                Play again
              </Button>
            ) : (
              <Button autoFocus onClick={() => setPlaying((x) => !x)}>
                {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
                {playing ? "Pause" : "Play"}
              </Button>
            )}
          </div>
          <p className="tabular text-xs text-ink-2">
            {Math.min(t, total).toFixed(1)}s / {total.toFixed(1)}s · {isOutro ? "Ending" : `Scene ${index + 1} of ${scenes.length}`}
          </p>
        </div>
      </div>
    </dialog>
  );
}
