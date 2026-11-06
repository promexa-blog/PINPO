import "../guard";
import { ffprobe } from "./run";
import { AppError } from "../util";

/** Typed subset of ffprobe 4.x JSON (Phase 0: ffprobe-static ships 4.0.2 — use only fields it has). */
export interface MediaInfo {
  formatName: string;
  durationS: number;
  sizeBytes: number;
  video: null | {
    codec: string;
    width: number;
    height: number;
    pixFmt: string | null;
    fps: number;
    colorSpace: string | null;
    colorPrimaries: string | null;
    colorTransfer: string | null;
    durationS: number | null;
  };
  audio: null | { codec: string; sampleRate: number; channels: number; durationS: number | null };
}

interface RawStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_space?: string;
  color_primaries?: string;
  color_transfer?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

const rate = (r?: string) => {
  if (!r) return 0;
  const [n, d] = r.split("/").map(Number);
  return d ? n! / d : n ?? 0;
};

export async function probe(file: string): Promise<MediaInfo> {
  let raw: { streams?: RawStream[]; format?: { format_name: string; duration?: string; size?: string } };
  try {
    const { stdout } = await ffprobe(["-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
    raw = JSON.parse(stdout);
  } catch (err) {
    throw new AppError("MEDIA_UNREADABLE", `Can't read media file: ${(err as Error).message.slice(0, 300)}`, 422);
  }
  const v = raw.streams?.find((s) => s.codec_type === "video");
  const a = raw.streams?.find((s) => s.codec_type === "audio");
  return {
    formatName: raw.format?.format_name ?? "",
    durationS: Number(raw.format?.duration ?? 0),
    sizeBytes: Number(raw.format?.size ?? 0),
    video: v
      ? {
          codec: v.codec_name,
          width: v.width ?? 0,
          height: v.height ?? 0,
          pixFmt: v.pix_fmt ?? null,
          fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate),
          colorSpace: v.color_space ?? null,
          colorPrimaries: v.color_primaries ?? null,
          colorTransfer: v.color_transfer ?? null,
          durationS: v.duration ? Number(v.duration) : null,
        }
      : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0, durationS: a.duration ? Number(a.duration) : null } : null,
  };
}
