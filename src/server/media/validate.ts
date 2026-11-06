import "../guard";
import { open } from "node:fs/promises";
import { probe, type MediaInfo } from "./probe";
import { ffmpeg, type RunOptions } from "./run";

/** FFprobe-based validation (plan §6). Each check returns pass/warn/fail with a plain message. */

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  key: string;
  status: CheckStatus;
  message: string;
  value?: unknown;
}

export interface ClipExpectation {
  requestedS: number;
  minShortSide: number;
  expectAudio: boolean | null;
}

/** Full decode with zero errors (catches truncated/corrupt files). */
export async function decodeErrors(file: string, run?: RunOptions): Promise<string | null> {
  try {
    const { stderrTail } = await ffmpeg(["-v", "error", "-i", file, "-f", "null", "-"], run);
    return stderrTail.trim() ? stderrTail.trim().slice(0, 500) : null;
  } catch (err) {
    return (err as Error).message.slice(0, 500);
  }
}

export async function validateClip(file: string, exp: ClipExpectation, run?: RunOptions): Promise<{ ok: boolean; checks: Check[]; info: MediaInfo | null }> {
  const checks: Check[] = [];
  let info: MediaInfo | null = null;
  try {
    info = await probe(file);
  } catch (e) {
    checks.push({ key: "readable", status: "fail", message: (e as Error).message });
    return { ok: false, checks, info };
  }
  checks.push({ key: "readable", status: "pass", message: "Container readable" });
  if (!info.video) checks.push({ key: "video_stream", status: "fail", message: "No video stream" });
  else {
    const short = Math.min(info.video.width, info.video.height);
    checks.push({ key: "resolution", status: short >= exp.minShortSide ? "pass" : "fail", message: `${info.video.width}×${info.video.height}`, value: short });
    checks.push({ key: "fps", status: info.video.fps > 0 ? "pass" : "fail", message: `${info.video.fps.toFixed(2)} fps` });
  }
  const d = info.durationS;
  const durOk = d >= exp.requestedS - 0.3 && d <= exp.requestedS + 1.0;
  checks.push({ key: "duration", status: durOk ? "pass" : "fail", message: `${d.toFixed(2)}s (requested ${exp.requestedS}s)`, value: d });
  if (exp.expectAudio !== null) {
    checks.push({ key: "audio_stream", status: !!info.audio === exp.expectAudio ? "pass" : "warn", message: info.audio ? "Has audio" : "No audio" });
  }
  checks.push({ key: "size", status: info.sizeBytes > 0 ? "pass" : "fail", message: `${info.sizeBytes} bytes` });
  const decode = await decodeErrors(file, run);
  checks.push({ key: "decode", status: decode ? "fail" : "pass", message: decode ? `Decode errors: ${decode}` : "Decodes cleanly" });
  return { ok: checks.every((c) => c.status !== "fail"), checks, info };
}

export interface FinalExpectation {
  width: number;
  height: number;
  durationS: number;
}

async function moovBeforeMdat(file: string): Promise<boolean> {
  const fh = await open(file, "r");
  try {
    let pos = 0;
    const header = Buffer.alloc(16);
    for (let i = 0; i < 64; i++) {
      const { bytesRead } = await fh.read(header, 0, 16, pos);
      if (bytesRead < 8) return false;
      let size = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (type === "moov") return true;
      if (type === "mdat") return false;
      if (size === 1) size = Number(header.readBigUInt64BE(8));
      if (size < 8) return false;
      pos += size;
    }
    return false;
  } finally {
    await fh.close();
  }
}

/** Integrated loudness (LUFS) via ebur128; null when the track is silent. */
export async function loudness(file: string, run?: RunOptions): Promise<number | null> {
  try {
    const { stderrTail } = await ffmpeg(["-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], run);
    const m = /I:\s+(-?[\d.]+|-inf)\s+LUFS\s+[\s\S]*$/m.exec(stderrTail);
    const all = [...stderrTail.matchAll(/I:\s+(-?[\d.]+)\s+LUFS/g)];
    const last = all[all.length - 1]?.[1] ?? (m?.[1] === "-inf" ? null : m?.[1]);
    return last ? Number(last) : null;
  } catch {
    return null;
  }
}

async function detect(file: string, filter: string, re: RegExp, run?: RunOptions): Promise<number> {
  try {
    const { stderrTail } = await ffmpeg(["-nostats", "-i", file, ...filter.split(" "), "-f", "null", "-"], run);
    return [...stderrTail.matchAll(re)].length;
  } catch {
    return 0;
  }
}

export async function validateFinal(file: string, exp: FinalExpectation, opts: { expectSound: boolean }, run?: RunOptions): Promise<{ ok: boolean; checks: Check[]; info: MediaInfo | null }> {
  const checks: Check[] = [];
  const info = await probe(file).catch(() => null);
  if (!info || !info.video) return { ok: false, checks: [{ key: "readable", status: "fail", message: "Final video can't be read" }], info };
  const v = info.video;
  checks.push({ key: "resolution", status: v.width === exp.width && v.height === exp.height ? "pass" : "fail", message: `${v.width}×${v.height} (expected ${exp.width}×${exp.height})` });
  checks.push({ key: "duration", status: Math.abs(info.durationS - exp.durationS) <= 0.1 ? "pass" : "fail", message: `${info.durationS.toFixed(2)}s (planned ${exp.durationS}s)`, value: info.durationS });
  checks.push({ key: "fps", status: Math.abs(v.fps - 30) < 0.01 ? "pass" : "fail", message: `${v.fps.toFixed(2)} fps` });
  checks.push({ key: "codec", status: v.codec === "h264" && v.pixFmt === "yuv420p" ? "pass" : "fail", message: `${v.codec} ${v.pixFmt}` });
  checks.push({ key: "color", status: v.colorSpace === "bt709" && v.colorPrimaries === "bt709" ? "pass" : "fail", message: `colour ${v.colorSpace}/${v.colorPrimaries}/${v.colorTransfer}` });
  const a = info.audio;
  checks.push({ key: "audio_format", status: a && a.codec === "aac" && a.sampleRate === 48000 && a.channels === 2 ? "pass" : "fail", message: a ? `${a.codec} ${a.sampleRate} Hz ${a.channels}ch` : "No audio track" });
  checks.push({ key: "faststart", status: (await moovBeforeMdat(file)) ? "pass" : "fail", message: "moov atom before media data (streams instantly)" });
  const decode = await decodeErrors(file, run);
  checks.push({ key: "decode", status: decode ? "fail" : "pass", message: decode ? `Decode errors: ${decode}` : "Decodes cleanly" });
  const lufs = await loudness(file, run);
  if (opts.expectSound) {
    const ok = lufs !== null && Math.abs(lufs + 14) <= 2;
    checks.push({ key: "loudness", status: ok ? "pass" : "fail", message: lufs === null ? "Silent" : `${lufs.toFixed(1)} LUFS (target −14 ±2)`, value: lufs });
  } else {
    checks.push({ key: "loudness", status: "warn", message: "No music or clip audio — the ad is silent", value: lufs });
  }
  const black = await detect(file, "-vf blackdetect=d=0.5:pix_th=0.05", /black_start/g, run);
  checks.push({ key: "black_frames", status: black ? "warn" : "pass", message: black ? `${black} black segment(s) ≥0.5s` : "No black gaps" });
  if (opts.expectSound) {
    const silent = await detect(file, "-af silencedetect=n=-50dB:d=1.0", /silence_start/g, run);
    checks.push({ key: "silence", status: silent ? "warn" : "pass", message: silent ? `${silent} silent gap(s) ≥1s` : "No silent gaps" });
  }
  return { ok: checks.every((c) => c.status !== "fail"), checks, info };
}
