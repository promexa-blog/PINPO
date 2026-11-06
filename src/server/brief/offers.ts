import "../guard";
import type { OffersInput } from "@/lib/brief";

/** Discount is always computed (never typed) and rounded DOWN so it's never overstated (plan §4, §9). */
export function discountPercent(priceInr: number, mrpInr: number): number {
  if (mrpInr <= priceInr) return 0;
  return Math.floor(((mrpInr - priceInr) / mrpInr) * 100);
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function formatInr(n: number): string {
  return inr.format(n);
}

export interface OfferLine {
  price: string | null;
  mrp: string | null;
  discount: string | null;
  validUntil: string | null;
}

/** The only way price/offer text reaches an ad: generated from brief values. */
export function offerLine(o: OffersInput): OfferLine | null {
  if (!o.priceInr) return null;
  const pct = o.mrpInr ? discountPercent(o.priceInr, o.mrpInr) : 0;
  return {
    price: formatInr(o.priceInr),
    mrp: o.mrpInr && pct > 0 ? formatInr(o.mrpInr) : null,
    discount: pct > 0 ? `${pct}% off` : null,
    validUntil: o.validUntil ? `Offer valid till ${formatDate(o.validUntil)}` : null,
  };
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export interface OfferIssue {
  code: "PRICE_ABOVE_MRP" | "OFFER_EXPIRED" | "GROUP_BUY_EXPIRED" | "PRICE_STALE" | "MRP_WITHOUT_PRICE";
  severity: "fail" | "needs_review";
  message: string;
}

/** Offer accuracy rules evaluated at a given date (YYYY-MM-DD, India time is used by callers). */
export function offerIssues(o: OffersInput, today: string): OfferIssue[] {
  const issues: OfferIssue[] = [];
  if (o.priceInr && o.mrpInr && o.mrpInr < o.priceInr) issues.push({ code: "PRICE_ABOVE_MRP", severity: "fail", message: "Selling price is higher than MRP." });
  if (o.mrpInr && !o.priceInr) issues.push({ code: "MRP_WITHOUT_PRICE", severity: "fail", message: "MRP is shown without a selling price." });
  if (o.validUntil && o.validUntil < today) issues.push({ code: "OFFER_EXPIRED", severity: "fail", message: `The offer ended on ${formatDate(o.validUntil)}.` });
  if (o.groupBuy && o.groupBuy.deadline < today) issues.push({ code: "GROUP_BUY_EXPIRED", severity: "fail", message: `The group-buy deadline (${formatDate(o.groupBuy.deadline)}) has passed.` });
  if (o.priceInr) {
    const confirmed = o.confirmedOn;
    if (!confirmed || daysBetween(confirmed, today) > 7) {
      issues.push({ code: "PRICE_STALE", severity: "needs_review", message: "Re-confirm the current price — it was last confirmed more than 7 days ago." });
    }
  }
  return issues;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** India date for "today" checks (offers are local to Kerala). */
export function indiaToday(d = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
