import "../guard";
import { ffmpeg, type RunOptions } from "./run";

/** Per-clip ffmpeg steps (plan §6): normalize AI clips, animate product stills, build the outro. */

const VIDEO_OUT = (crf: number) => [
  "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-r", "30", "-video_track_timescale", "15360",
];
const AUDIO_OUT = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
const n = (x: number) => Number(x.toFixed(4)).toString();

export interface NormalizeOpts {
  width: number;
  height: number;
  durationS: number;
  keepAudio: boolean;
  sourceHasAudio: boolean;
}

/** AI clip → exact W×H (cover + centre crop), 30 fps CFR, BT.709, exact duration (freeze-extends if short). */
export async function normalizeClip(src: string, dst: string, o: NormalizeOpts, run?: RunOptions): Promise<void> {
  const D = n(o.durationS);
  const v = `[0:v]scale=${o.width}:${o.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${o.width}:${o.height},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},setpts=PTS-STARTPTS,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`;
  const a =
    o.keepAudio && o.sourceHasAudio
      ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${D},asetpts=PTS-STARTPTS[a]`
      : `[1:a]atrim=duration=${D},asetpts=PTS-STARTPTS[a]`;
  await ffmpeg(
    ["-y", "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", ...VIDEO_OUT(17), ...AUDIO_OUT, "-t", D, dst],
    run,
  );
}

export type ProductMotion = "push-in" | "pan" | "parallax" | "rotate-in";

/** Zoom reached at the push-in hold point; the product check measures at this zoom. */
export const PUSH_IN_ZOOM = 1.08;

/**
 * Animates the original product canvas (rendered at canvasScale × frame) without altering it:
 * only uniform scaling and cropping — never stretching. The motion settles in the last 15%
 * (the "hold point" used by the product-preservation check). CRF 16 (plan §7).
 *
 * Phase 3 finding: ffmpeg 7.0.2 corrupts memory when a per-frame (eval=frame) scale feeds
 * pad/format, and crop offsets use the FIRST frame's size. So zoom uses `zoompan` (fixed output
 * size, centred every frame) on a 2× upscaled canvas for sub-pixel smoothness.
 */
export async function productClip(canvasPng: string, dst: string, o: { width: number; height: number; durationS: number; motion: ProductMotion; canvasScale: number }, run?: RunOptions): Promise<void> {
  const D = o.durationS;
  const frames = Math.round(D * 30);
  const settleF = n(Math.max(1, frames * 0.85));
  const p = `min(1,on/${settleF})`;
  const ease = `(${p}*${p}*(3-2*${p}))`;
  const W = o.width;
  const H = o.height;
  let chain: string;
  if (o.motion === "pan" || o.motion === "parallax") {
    // Fixed 1.06× of the frame (fixed-size crop, per-frame x/y only) — camera drifts horizontally.
    const scaleW = Math.round((W * 1.06) / 2) * 2;
    const scaleH = Math.round((H * 1.06) / 2) * 2;
    const t = `min(1,t/${n(D * 0.85)})`;
    const e = `(${t}*${t}*(3-2*${t}))`;
    const y = o.motion === "parallax" ? `${(scaleH - H) / 2}+${(scaleH - H) * 0.3}*(${e}-0.5)` : `${(scaleH - H) / 2}`;
    chain = `scale=${scaleW}:${scaleH}:flags=lanczos,crop=${W}:${H}:x='${scaleW - W}*${e}':y='${y}'`;
  } else {
    chain = `scale=iw*2:ih*2:flags=lanczos,zoompan=z='1+${PUSH_IN_ZOOM - 1}*${ease}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30`;
  }
  await ffmpeg(
    [
      "-y", "-loop", "1", "-framerate", "30", "-t", n(D), "-i", canvasPng, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-filter_complex", `[0:v]${chain},setsar=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];[1:a]atrim=duration=${n(D)}[a]`,
      "-map", "[v]", "-map", "[a]", ...VIDEO_OUT(16), ...AUDIO_OUT, "-t", n(D), dst,
    ],
    run,
  );
}

/** Outro PNG → clip with the logo-reveal motion (content grows 0.98 → 1.0 over 0.6 s). */
export async function outroClip(png: string, dst: string, o: { width: number; height: number; durationS: number }, run?: RunOptions): Promise<void> {
  const D = n(o.durationS);
  const p = "min(1,on/18)";
  await ffmpeg(
    [
      "-y", "-loop", "1", "-framerate", "30", "-t", D, "-i", png, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-filter_complex",
      `[0:v]scale=iw*2:ih*2:flags=lanczos,zoompan=z='1+0.02*${p}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${o.width}x${o.height}:fps=30,setsar=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];[1:a]atrim=duration=${D}[a]`,
      "-map", "[v]", "-map", "[a]", ...VIDEO_OUT(16), ...AUDIO_OUT, "-t", D, dst,
    ],
    run,
  );
}

export async function extractFrame(src: string, atS: number, dst: string, run?: RunOptions): Promise<void> {
  await ffmpeg(["-y", "-ss", n(atS), "-i", src, "-frames:v", "1", "-vf", "scale=in_color_matrix=bt709:in_range=tv", dst], run);
}

export async function thumbnail(src: string, atS: number, dst: string, run?: RunOptions): Promise<void> {
  await ffmpeg(["-y", "-ss", n(atS), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2:flags=lanczos", "-q:v", "3", dst], run);
}
