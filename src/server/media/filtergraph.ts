import "../guard";
import type { Timeline } from "../planning/timeline";

/**
 * Pure builder for the final composition filtergraph (plan §6). No I/O — snapshot tested (U6).
 * Input order: [scene clips…][outro clip][overlay PNGs…][music?]
 */

export type XfadeKind = "cut" | "crossfade" | "dip_white" | "dip_primary" | "slide";
export type AudioMode = "music_only" | "clip_only" | "mix";
export type OverlayMotion = "fade-up" | "slide-in" | "scale-in" | "logo-reveal";

export interface OverlaySpec {
  /** Output-time window. */
  startS: number;
  endS: number;
  motion: OverlayMotion;
}

export interface ComposeGraphInput {
  timeline: Timeline;
  transitions: XfadeKind[]; // one per scene (last = into outro)
  overlays: OverlaySpec[];
  width: number;
  height: number;
  audioMode: AudioMode;
  hasMusic: boolean;
  musicVolumeDb: number;
}

const XFADE: Record<Exclude<XfadeKind, "cut">, string> = {
  crossfade: "fade",
  dip_white: "fadewhite",
  // xfade has no custom-colour dip; fadeblack is the closest to DemandMesh primary (#0C1C28).
  dip_primary: "fadeblack",
  slide: "slideleft",
};

const f = (n: number) => Number(n.toFixed(4)).toString();

export function buildComposeGraph(g: ComposeGraphInput): { filter: string; videoOut: string; audioOut: string } {
  const segs = g.timeline.segments;
  const n = segs.length;
  const outroIdx = n;
  const parts: string[] = [];

  // Same timebase/rate/format for every clip so xfade/concat can join them (Phase 3 finding).
  for (let i = 0; i <= n; i++) {
    parts.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=30,format=yuv420p[s${i}]`);
    parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[sa${i}]`);
  }
  // Video + clip-audio chains, joined in order.
  let v = "[s0]";
  let a = "[sa0]";
  for (let i = 1; i <= n; i++) {
    const kind = g.transitions[i - 1] ?? "crossfade";
    const T = segs[i - 1]!.transitionOutS;
    const nextStart = i < n ? segs[i]!.startS : g.timeline.outro.startS;
    const vOut = `[v${i}]`;
    const aOut = `[a${i}]`;
    const input = i < n ? i : outroIdx;
    if (kind === "cut" || T === 0) {
      parts.push(`${v}[s${input}]concat=n=2:v=1:a=0,fps=30${vOut}`);
      parts.push(`${a}[sa${input}]concat=n=2:v=0:a=1${aOut}`);
    } else {
      parts.push(`${v}[s${input}]xfade=transition=${XFADE[kind]}:duration=${f(T)}:offset=${f(nextStart)}${vOut}`);
      parts.push(`${a}[sa${input}]acrossfade=d=${f(T)}:c1=tri:c2=tri${aOut}`);
    }
    v = vOut;
    a = aOut;
  }

  // Overlays (transparent PNG layers) with alpha fades and small motion.
  const firstOverlayInput = n + 1;
  g.overlays.forEach((o, k) => {
    const idx = firstOverlayInput + k;
    const fadeIn = 0.4;
    const fadeOut = 0.3;
    const dur = Math.max(0.1, o.endS - o.startS);
    parts.push(
      `[${idx}:v]format=rgba,fade=t=in:st=${f(o.startS)}:d=${f(Math.min(fadeIn, dur / 3))}:alpha=1,fade=t=out:st=${f(o.endS - Math.min(fadeOut, dur / 3))}:d=${f(Math.min(fadeOut, dur / 3))}:alpha=1[ov${k}]`,
    );
    const p = `min(1,max(0,(t-${f(o.startS)})/0.45))`;
    const ease = `(1-pow(1-${p},3))`;
    const x = o.motion === "slide-in" ? `-${Math.round(g.width * 0.04)}*(1-${ease})` : "0";
    const y = o.motion === "fade-up" ? `${Math.round(g.height * 0.02)}*(1-${ease})` : "0";
    const out = `[vo${k}]`;
    parts.push(`${v}[ov${k}]overlay=x='${x}':y='${y}':eval=frame:enable='between(t,${f(o.startS)},${f(o.endS)})'${out}`);
    v = out;
  });

  const total = g.timeline.totalS;
  parts.push(`${v}fps=30,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,trim=duration=${f(total)},setpts=PTS-STARTPTS[vout]`);

  // Audio: clip audio, music, or music ducked under clip audio.
  const musicIdx = firstOverlayInput + g.overlays.length;
  const clip = a;
  if (g.hasMusic && g.audioMode !== "clip_only") {
    parts.push(
      `[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${f(g.musicVolumeDb)}dB,atrim=duration=${f(total)},asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=${f(Math.max(0, total - 1.5))}:d=1.5[music]`,
    );
    if (g.audioMode === "mix") {
      parts.push(`${clip}asplit=2[clipA][clipSC]`);
      parts.push(`[music][clipSC]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]`);
      parts.push(`[ducked][clipA]amix=inputs=2:duration=first:normalize=0[mixed]`);
    } else {
      parts.push(`${clip}anullsink`);
      parts.push(`[music]anull[mixed]`);
    }
  } else {
    parts.push(`${clip}anull[mixed]`);
  }
  parts.push(`[mixed]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${f(total)},asetpts=PTS-STARTPTS[aout]`);

  return { filter: parts.join(";\n"), videoOut: "[vout]", audioOut: "[aout]" };
}
