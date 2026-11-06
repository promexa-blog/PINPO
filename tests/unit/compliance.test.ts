import { describe, it, expect } from "vitest";
import { classify, evaluateClaim, isEndorsementPrompt, type ClaimLike } from "@/server/brief/claims";
import { discountPercent, formatInr, offerIssues, offerLine } from "@/server/brief/offers";
import type { OffersInput } from "@/lib/brief";

const offers: OffersInput = { stockConfirmed: false };
const c = (text: string, extra: Partial<ClaimLike> = {}): ClaimLike => ({ text, language: "en", confirmed: true, attested: false, testimonialConsent: false, ...extra });

describe("claim classification", () => {
  it("detects regulated categories in EN, ML and HI", () => {
    expect(classify("Cures acne in 7 days")).toContain("medical_health");
    expect(classify("മുഖക്കുരുവിന് ചികിത്സ")).toContain("medical_health");
    expect(classify("बीमारी से बचाए")).toContain("medical_health");
    expect(classify("No side effects, 100% safe")).toContain("safety");
    expect(classify("सुरक्षित और भरोसेमंद")).toContain("safety");
    expect(classify("Battery lasts 12 hours")).toContain("performance");
    expect(classify("The best lunch box in Kerala")).toContain("comparative");
    expect(classify("ഏറ്റവും മികച്ച ഗുണനിലവാരം")).toContain("comparative");
    expect(classify("Eco-friendly bamboo")).toContain("environmental");
    expect(classify("Rated 4.9★ by customers")).toContain("testimonial");
    expect(classify("Only today!")).toContain("urgency");
    expect(classify("ഇന്ന് മാത്രം")).toContain("urgency");
    expect(classify("Three separate tiers keep food apart")).toEqual(["general"]);
  });
});

describe("claim rules (M1–M6)", () => {
  it("M1: medical claim without evidence fails", () => {
    expect(evaluateClaim(c("Cures acne in 7 days"), offers).status).toBe("fail");
  });
  it("M2: medical claim with evidence + attestation needs review", () => {
    expect(evaluateClaim(c("Dermatologist-tested formula", { substantiation: "Lab report DT-2026-11", attested: true }), offers).status).toBe("needs_review");
  });
  it("M3: safety wording without evidence fails", () => {
    expect(evaluateClaim(c("No side effects"), offers).status).toBe("fail");
    expect(evaluateClaim(c("100% safe for kids"), offers).status).toBe("fail");
  });
  it("M4: ratings/reviews without a real testimonial record fail", () => {
    expect(evaluateClaim(c("Rated 4.9★ by customers"), offers).status).toBe("fail");
    expect(evaluateClaim(c("“Best purchase I made this year”"), offers).status).toBe("fail");
    expect(evaluateClaim(c("Loved by 10,000 customers", { source: "Order DB export", testimonialConsent: true, substantiation: "x", attested: true }), offers).status).toBe("needs_review");
  });
  it("M5: prompts asking for invented endorsements are detected", () => {
    expect(isEndorsementPrompt("A happy customer giving a review to camera")).toBe(true);
    expect(isEndorsementPrompt("People holding a five-star sign")).toBe(true);
    expect(isEndorsementPrompt("A woman packing lunch in a bright kitchen")).toBe(false);
  });
  it("M6: urgency needs backing data", () => {
    expect(evaluateClaim(c("Only today!"), offers).status).toBe("fail");
    expect(evaluateClaim(c("Only today!"), { ...offers, validUntil: "2026-11-30" }).status).toBe("pass");
    expect(evaluateClaim(c("Limited stock"), offers).status).toBe("fail");
    expect(evaluateClaim(c("Limited stock"), { ...offers, stockConfirmed: true, stockStatement: "50 units this batch" }).status).toBe("pass");
  });
  it("unconfirmed and price-in-benefit claims fail", () => {
    expect(evaluateClaim(c("Keeps food apart", { confirmed: false }), offers).status).toBe("fail");
    expect(evaluateClaim(c("Now just ₹499"), offers).status).toBe("fail");
    expect(evaluateClaim(c("Keeps food apart"), offers).status).toBe("pass");
  });
});

describe("offers (M7, M8, O2)", () => {
  it("computes discount rounding down and formats INR", () => {
    expect(discountPercent(899, 1299)).toBe(30);
    expect(discountPercent(1000, 1000)).toBe(0);
    expect(formatInr(1299)).toBe("₹1,299");
    expect(formatInr(125000)).toBe("₹1,25,000");
    expect(offerLine({ priceInr: 899, mrpInr: 1299, validUntil: "2026-11-30", stockConfirmed: false })).toEqual({ price: "₹899", mrp: "₹1,299", discount: "30% off", validUntil: "Offer valid till 30 Nov 2026" });
  });
  it("M7: expired offers and group-buy deadlines fail", () => {
    const codes = offerIssues({ priceInr: 899, validUntil: "2026-11-01", groupBuy: { groupPriceInr: 799, minBuyers: 5, deadline: "2026-11-02" }, stockConfirmed: false, confirmedOn: "2026-11-06" }, "2026-11-06").map((i) => i.code);
    expect(codes).toEqual(["OFFER_EXPIRED", "GROUP_BUY_EXPIRED"]);
  });
  it("M8: price above MRP fails, stale price needs review", () => {
    const issues = offerIssues({ priceInr: 1500, mrpInr: 1299, stockConfirmed: false, confirmedOn: "2026-10-20" }, "2026-11-06");
    expect(issues.find((i) => i.code === "PRICE_ABOVE_MRP")?.severity).toBe("fail");
    expect(issues.find((i) => i.code === "PRICE_STALE")?.severity).toBe("needs_review");
  });
});
