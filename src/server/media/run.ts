import "../guard";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { AppError } from "../util";

export const FFMPEG = ffmpegPath as unknown as string;
export const FFPROBE = ffprobeStatic.path;

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called with ffmpeg `-progress pipe:1` out_time in seconds. */
  onProgress?: (seconds: number) => void;
}

export interface RunResult {
  stdout: string;
  stderrTail: string;
}

/** Spawns ffmpeg/ffprobe with an argument array (never a shell), with timeout, cancel and stderr tail. */
export function runBinary(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const tail: string[] = [];
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve({ stdout, stderrTail: tail.join("") });
    };
    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 5000).unref();
    };
    const onAbort = () => {
      kill();
      finish(new AppError("CANCELED", "Process canceled", 499));
    };
    const timer = setTimeout(() => {
      kill();
      finish(new AppError("FFMPEG_TIMEOUT", `${bin.split("/").pop()} timed out`, 500));
    }, opts.timeoutMs ?? 30 * 60_000);
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (opts.onProgress) {
        for (const m of s.matchAll(/out_time_us=(\d+)/g)) opts.onProgress(Number(m[1]) / 1e6);
      }
      if (stdout.length < 8 * 1024 * 1024) stdout += s;
    });
    child.stderr.on("data", (d: Buffer) => {
      tail.push(d.toString());
      while (tail.join("").length > 8000) tail.shift();
    });
    child.on("error", (e) => finish(e));
    child.on("close", (code) => {
      if (code === 0) finish(null);
      else {
        const err = new AppError("FFMPEG_FAILED", `${bin.split("/").pop()} exited with ${code}: ${tail.join("").slice(-1500)}`, 500);
        finish(err);
      }
    });
  });
}

export const ffmpeg = (args: string[], opts?: RunOptions) => runBinary(FFMPEG, ["-hide_banner", "-nostdin", ...args], opts);
export const ffprobe = (args: string[], opts?: RunOptions) => runBinary(FFPROBE, ["-v", "error", ...args], opts);
