import "../guard";
import type { GenMode, ModelSpec, PricePeriod, Resolution } from "./types";
import { requestDuration } from "./types";

function periodFor(periods: PricePeriod[], date: string): PricePeriod {
  return periods.find((p) => (!p.from || date >= p.from) && (!p.until || date <= p.until)) ?? periods[periods.length - 1]!;
}

/**
 * List price per second in effect on `date` (YYYY-MM-DD) for a mode, resolution and audio choice.
 * Mode-specific tables (e.g. MiniMax reference) override the default table.
 */
export function pricePerSecond(model: ModelSpec, resolution: Resolution, date: string, mode: GenMode = "t2v", audio = false): number {
  const periods = model.pricing.modes?.[mode] ?? model.pricing.periods;
  const p = periodFor(periods, date);
  const base = p.perSecond[resolution];
  if (base === undefined) throw new Error(`${model.label} has no price for ${resolution}`);
  const extra = audio && model.audio === "toggle" ? p.audioPerSecond?.[resolution] ?? 0 : 0;
  return base + extra;
}

export function pricingVersion(model: ModelSpec, date: string): string {
  return `${model.id}@${model.pricing.verifiedAt}/${date}`;
}

/** List-price cost of one fal request (requested — not planned — duration). */
export function clipListPrice(model: ModelSpec, resolution: Resolution, plannedS: number, date: string, mode: GenMode = "t2v", audio = false): { usd: number; requestedS: number } {
  const requestedS = requestDuration(model, plannedS);
  return { usd: round4(requestedS * pricePerSecond(model, resolution, date, mode, audio)), requestedS };
}

/** Calculated cost from the delivered clip's measured duration (plan §10 "Calculated"). */
export function deliveredListPrice(model: ModelSpec, resolution: Resolution, deliveredS: number, date: string, mode: GenMode = "t2v", audio = false): number {
  return round4(deliveredS * pricePerSecond(model, resolution, date, mode, audio));
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const today = (d = new Date()) => d.toISOString().slice(0, 10);
