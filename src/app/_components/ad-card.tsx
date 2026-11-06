"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Aspect } from "@/lib/platforms";
import { Stage, AspectGlyph } from "./frame";
import { Status, type Tone } from "./ui";
import { CardActions } from "./card-actions";
import { IconPlay } from "./icons";

export interface AdCardData {
  id: string;
  name: string;
  href: string;
  aspect: Aspect;
  platformLabel: string;
  lengthS: number;
  version: number;
  versions: number;
  status: { label: string; tone: Tone };
  brandName: string | null;
  updated: string;
  thumbId: string | null;
  videoId: string | null;
  productId: string | null;
}

/** Library card: the ad at its true shape. Hover or keyboard focus plays it, muted. */
export function AdCard({ ad }: { ad: AdCardData }) {
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const start = () => ad.videoId && setPlaying(true);
  const stop = () => {
    setPlaying(false);
    video.current?.pause();
  };
  return (
    <li className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition-[border-color] duration-150 hover:border-line-strong focus-within:border-line-strong">
      <Link href={ad.href} onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop} className="flex flex-1 flex-col rounded-xl focus-visible:outline-offset-[-2px]">
        <Stage aspect={ad.aspect} className="aspect-[5/4]">
          {playing && ad.videoId ? (
            <video ref={video} src={`/api/assets/${ad.videoId}`} autoPlay muted loop playsInline preload="none" className="absolute inset-0 size-full object-cover" aria-hidden />
          ) : ad.thumbId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${ad.thumbId}`} alt="" className="absolute inset-0 size-full object-cover" />
          ) : ad.productId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${ad.productId}`} alt="" className="absolute inset-0 m-auto max-h-[70%] max-w-[78%] object-contain opacity-60" />
          ) : (
            <span className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-ink-3">No product photo yet</span>
          )}
          {ad.videoId && !playing ? (
            <span aria-hidden className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <IconPlay size={13} />
            </span>
          ) : null}
        </Stage>
        <div className="flex flex-1 flex-col gap-1.5 border-t border-line p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 font-semibold leading-snug">{ad.name}</p>
            <Status tone={ad.status.tone}>{ad.status.label}</Status>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2">
            <span className="inline-flex items-center gap-1">
              <AspectGlyph aspect={ad.aspect} size={13} />
              {ad.platformLabel}
            </span>
            <span aria-hidden>·</span>
            <span className="tabular">{ad.lengthS}s</span>
            <span aria-hidden>·</span>
            <span className="tabular">
              v{ad.version}
              {ad.versions > 1 ? ` of ${ad.versions}` : ""}
            </span>
          </p>
          <p className="mt-auto pt-1 text-xs text-ink-3">
            {ad.brandName ? `${ad.brandName} · ` : ""}
            {ad.updated}
          </p>
        </div>
      </Link>
      <CardActions adId={ad.id} name={ad.name} />
    </li>
  );
}
