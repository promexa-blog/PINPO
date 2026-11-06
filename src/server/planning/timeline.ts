import "../guard";
import { FPS, frameSeconds } from "@/lib/platforms";

/**
 * Single source of truth for timing (plan §6). With transition Tᵢ between scene i and i+1,
 * scene i+1 starts at startᵢ + dᵢ − Tᵢ. The outro is joined the same way. All values are in
 * whole frames at 30 fps.
 */

export interface TimelineScene {
  durationS: number;
  /** Overlap with the next segment (0 = hard cut). */
  transitionOutS: number;
}

export interface TimelineInput {
  scenes: TimelineScene[];
  outroS: number;
}

export interface TimelineSegment {
  index: number;
  startS: number;
  endS: number;
  durationS: number;
  transitionOutS: number;
}

export interface Timeline {
  segments: TimelineSegment[];
  outro: { startS: number; endS: number; durationS: number };
  totalS: number;
}

export class TimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineError";
  }
}

const EPS = 1e-6;

export function computeTimeline(input: TimelineInput): Timeline {
  if (input.scenes.length === 0) throw new TimelineError("An ad needs at least one scene.");
  const segs: TimelineSegment[] = [];
  let start = 0;
  input.scenes.forEach((s, i) => {
    const d = frameSeconds(s.durationS);
    const t = frameSeconds(s.transitionOutS);
    const next = i + 1 < input.scenes.length ? frameSeconds(input.scenes[i + 1]!.durationS) : frameSeconds(input.outroS);
    if (d <= 0) throw new TimelineError(`Scene ${i + 1} has no duration.`);
    if (t < 0) throw new TimelineError(`Scene ${i + 1} has a negative transition.`);
    if (t > Math.min(d, next) / 3 + EPS) throw new TimelineError(`Transition after scene ${i + 1} is too long (max ${(Math.min(d, next) / 3).toFixed(2)}s).`);
    segs.push({ index: i, startS: round(start), endS: round(start + d), durationS: d, transitionOutS: t });
    start = start + d - t;
  });
  const outroS = frameSeconds(input.outroS);
  const outroStart = round(start);
  return { segments: segs, outro: { startS: outroStart, endS: round(outroStart + outroS), durationS: outroS }, totalS: round(outroStart + outroS) };
}

/** Sum of scene durations needed so the finished ad is exactly `totalS` long. */
export function sceneBudget(totalS: number, outroS: number, transitions: number[]): number {
  return round(totalS - outroS + transitions.reduce((a, b) => a + b, 0));
}

const round = (s: number) => Math.round(s * FPS) / FPS;
