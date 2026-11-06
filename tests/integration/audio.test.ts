import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { paths } from "@/server/paths";
import { ffmpeg } from "@/server/media/run";
import { buildComposeGraph } from "@/server/media/filtergraph";
import { computeTimeline } from "@/server/planning/timeline";
import { loudness } from "@/server/media/validate";

/** Plan test V1: music ducks ≥ 8 dB under voiceover; VO timing ±40 ms; final loudness in range. */

const dir = path.join(paths.work, "audio-test");
const p = (n: string) => path.join(dir, n);

async function bandRms(file: string, freq: number, from: number, to: number): Promise<number> {
  const { stderrTail } = await ffmpeg(["-nostats", "-i", file, "-af", `bandpass=f=${freq}:width_type=q:w=8,atrim=start=${from}:end=${to},astats=metadata=0`, "-f", "null", "-"]);
  const m = [...stderrTail.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)].pop();
  return m && m[1] !== "-inf" ? Number(m[1]) : -120;
}

async function onset(file: string, freq: number, thresholdDb: number): Promise<number | null> {
  const out = p(`onset-${freq}.txt`);
  await ffmpeg(["-nostats", "-i", file, "-af", `bandpass=f=${freq}:width_type=q:w=8,asetnsamples=n=480:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${out}`, "-f", "null", "-"]);
  const lines = readFileSync(out, "utf8").split("\n");
  let t: number | null = null;
  for (const line of lines) {
    const pt = /pts_time:([\d.]+)/.exec(line);
    if (pt) t = Number(pt[1]);
    const v = /RMS_level=(-?[\d.]+)/.exec(line);
    if (v && t !== null && Number(v[1]) > thresholdDb) return t;
  }
  return null;
}

describe("voiceover mixing (V1)", () => {
  it("ducks music under the voiceover, keeps VO timing and normalises loudness", async () => {
    mkdirSync(dir, { recursive: true });
    const W = 540;
    const H = 960;
    // One silent 6 s scene, a 2 s outro, music tone 300 Hz, voiceover tone 1000 Hz (2 s).
    await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=gray:s=${W}x${H}:r=30:d=6`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-r", "30", "-video_track_timescale", "15360", p("scene.mp4")]);
    await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=white:s=${W}x${H}:r=30:d=2`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-r", "30", "-video_track_timescale", "15360", p("outro.mp4")]);
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=f=300:d=20:sample_rate=48000", "-c:a", "aac", p("music.m4a")]);
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=f=1000:d=2:sample_rate=48000", "-c:a", "aac", p("vo.m4a")]);

    const tl = computeTimeline({ scenes: [{ durationS: 6, transitionOutS: 0.5 }], outroS: 2 });
    const voStart = 2.0;
    const g = buildComposeGraph({
      timeline: tl,
      transitions: ["crossfade"],
      overlays: [],
      width: W,
      height: H,
      audioMode: "music_only",
      hasMusic: true,
      musicVolumeDb: -6,
      voiceovers: [{ startS: voStart, durationS: 2, volumeDb: 0, fadeInS: 0, fadeOutS: 0.1 }],
      duckClipUnderVoice: true,
    });
    await ffmpeg([
      "-y", "-i", p("scene.mp4"), "-i", p("outro.mp4"), "-stream_loop", "-1", "-i", p("music.m4a"), "-i", p("vo.m4a"),
      "-filter_complex", g.filter, "-map", g.videoOut, "-map", g.audioOut, "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-t", String(tl.totalS), p("final.mp4"),
    ]);

    const musicBefore = await bandRms(p("final.mp4"), 300, 0.8, 1.8);
    const musicDuring = await bandRms(p("final.mp4"), 300, 2.6, 3.6);
    expect(musicBefore - musicDuring).toBeGreaterThanOrEqual(8);

    const voAt = await onset(p("final.mp4"), 1000, -40);
    expect(voAt).not.toBeNull();
    expect(Math.abs(voAt! - voStart)).toBeLessThanOrEqual(0.04);

    const lufs = await loudness(p("final.mp4"));
    expect(lufs).not.toBeNull();
    expect(Math.abs(lufs! + 14)).toBeLessThanOrEqual(2);
  }, 180_000);
});
