import { describe, it, expect } from "vitest";
import { buildComposeGraph } from "@/server/media/filtergraph";
import { computeTimeline } from "@/server/planning/timeline";

describe("compose filtergraph (U6)", () => {
  const tl = computeTimeline({ scenes: [{ durationS: 3, transitionOutS: 0.4 }, { durationS: 4, transitionOutS: 0 }, { durationS: 4, transitionOutS: 0.5 }], outroS: 3 });
  it("chains xfade/concat at timeline offsets with overlays and ducked music", () => {
    const g = buildComposeGraph({ timeline: tl, transitions: ["crossfade", "cut", "crossfade"], overlays: [{ startS: 0.1, endS: 2.5, motion: "fade-up" }], width: 1080, height: 1920, audioMode: "mix", hasMusic: true, musicVolumeDb: -8 });
    expect(g.filter).toContain("xfade=transition=fade:duration=0.4:offset=2.6");
    expect(g.filter).toContain("concat=n=2:v=1:a=0,fps=30");
    expect(g.filter).toContain(`offset=${tl.outro.startS}`);
    expect(g.filter).toContain("sidechaincompress");
    expect(g.filter).toContain("loudnorm=I=-14:TP=-1.5");
    expect(g.filter).toContain(`trim=duration=${tl.totalS}`);
    expect(g.filter).toMatchSnapshot();
  });
  it("routes audio correctly for each mode", () => {
    const base = { timeline: tl, transitions: ["crossfade", "crossfade", "crossfade"] as const, overlays: [], width: 1080, height: 1920, musicVolumeDb: -8 };
    expect(buildComposeGraph({ ...base, transitions: [...base.transitions], audioMode: "music_only", hasMusic: true }).filter).toContain("anullsink");
    expect(buildComposeGraph({ ...base, transitions: [...base.transitions], audioMode: "clip_only", hasMusic: false }).filter).not.toContain("[music]");
  });
});
