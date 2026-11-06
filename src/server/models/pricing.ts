import "../guard";
import type { ModelSpec, Resolution } from "./registry";
import { requestDuration } from "./registry";

/** Price per second in effect on `date` (YYYY-MM-DD). Falls back to the latest open period. */
export function pricePerSecond(model: ModelSpec, resolution: Resolution, date: string): number {
  const periods = model.pricing.periods;
  const match = periods.find((p) => (!p.from || date >= p.from) && (!p.until || date <= p.until));
  const period = match ?? periods[periods.length - 1]!;
  return period.perSecond[resolution];
}

export function pricingVersion(model: ModelSpec, date: string): string {
  return `${model.id}@${model.pricing.verifiedAt}/${date}`;
}

/** List-price cost of one fal request (requested — not planned — duration). */
export function clipListPrice(model: ModelSpec, resolution: Resolution, plannedS: number, date: string): { usd: number; requestedS: number } {
  const requestedS = requestDuration(model, plannedS);
  return { usd: round4(requestedS * pricePerSecond(model, resolution, date)), requestedS };
}

/** Calculated cost from the delivered clip's measured duration (plan §10 "Calculated"). */
export function deliveredListPrice(model: ModelSpec, resolution: Resolution, deliveredS: number, date: string): number {
  return round4(deliveredS * pricePerSecond(model, resolution, date));
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const today = (d = new Date()) => d.toISOString().slice(0, 10);
