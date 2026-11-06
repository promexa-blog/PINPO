import "../../guard";
import type { BriefInput, Lang } from "@/lib/brief";
import type { SceneEdit } from "@/lib/version";
import { classify, evaluateClaim, isEndorsementPrompt, type ClaimLike } from "../../brief/claims";
import { offerIssues, offerLine } from "../../brief/offers";
import { groupBuyLines } from "../../planning/storyboard";

/**
 * Core advertising compliance over the ACTUAL overlay text (plan §9 [v2.2]): every line must trace
 * back to the brief (confirmed claim, product name, computed offer, CTA), regulated claims follow
 * the substantiation/attestation rules, offers must be accurate and current. Used to gate
 * Generate and again in the creative QA report.
 */

export type ItemStatus = "pass" | "warn" | "fail" | "needs_review";
export interface QaItem {
  check: string;
  method: "automated" | "heuristic" | "human";
  status: ItemStatus;
  message: string;
  evidence?: unknown;
}

export interface ComplianceInput {
  brief: BriefInput;
  scenes: Pick<SceneEdit, "overlay" | "prompt" | "sceneType">[];
  /** CTA shown in the outro. */
  outroCta: { lang: Lang; text: string };
  today: string;
  approvedCtas: Record<string, string[]>;
  brandLines?: { tagline: string; groupBuyLine: string };
}

export function complianceItems(input: ComplianceInput): QaItem[] {
  const { brief, scenes, today } = input;
  const items: QaItem[] = [];
  const claimsById = new Map(brief.claims.filter((c) => c.id).map((c) => [c.id!, c]));
  const offer = offerLine(brief.offers);
  const expectedOffer: Record<string, string | null> = {
    offer_price: offer?.price ?? null,
    offer_mrp: offer?.mrp ?? null,
    offer_discount: offer?.discount ?? null,
    offer_validity: offer?.validUntil ?? null,
    ...Object.fromEntries(groupBuyLines(brief).map((l) => [l.kind, l.text])),
  };
  if (!brief.offers.groupBuy) Object.assign(expectedOffer, { group_price: null, group_min: null, group_deadline: null });

  let claimFail = 0;
  let claimReview = 0;
  let offerFail = 0;
  const claimMessages: string[] = [];

  scenes.forEach((s, i) => {
    if (s.prompt && isEndorsementPrompt(s.prompt)) {
      items.push({ check: "fabricated_testimonial", method: "automated", status: "fail", message: `Scene ${i + 1}: the video prompt asks for a review or endorsement. Remove it.` });
    }
    for (const [lang, lines] of Object.entries(s.overlay.byLang) as [Lang, SceneEdit["overlay"]["byLang"][Lang]][]) {
      for (const line of lines ?? []) {
        const where = `Scene ${i + 1} (${lang.toUpperCase()})`;
        if (line.kind === "placeholder") {
          claimFail++;
          claimMessages.push(`${where}: placeholder "${line.text}" must be replaced.`);
          continue;
        }
        if (line.kind === "tagline" || line.kind === "brand_line") {
          const expected = line.kind === "tagline" ? input.brandLines?.tagline : input.brandLines?.groupBuyLine;
          if (line.text !== expected) {
            claimFail++;
            claimMessages.push(`${where}: "${line.text}" isn't the approved DemandMesh line.`);
          }
          continue;
        }
        if (line.kind === "product_name") {
          if (line.text !== brief.product.name) {
            claimFail++;
            claimMessages.push(`${where}: product name "${line.text}" doesn't match the brief.`);
          }
          continue;
        }
        if (line.kind === "claim") {
          const c = line.claimId ? claimsById.get(line.claimId) : undefined;
          if (!c || c.text !== line.text || c.language !== lang) {
            // Free text: classify it; it can only pass if it's identical to a confirmed brief claim.
            const verdict = evaluateClaim({ text: line.text, language: lang, confirmed: false, attested: false, testimonialConsent: false }, brief.offers);
            claimFail++;
            claimMessages.push(`${where}: "${line.text}" isn't a confirmed benefit from the brief${verdict.categories[0] !== "general" ? ` (${verdict.categories.join(", ")} wording)` : ""}.`);
            continue;
          }
          const verdict = evaluateClaim(c as ClaimLike, brief.offers);
          if (verdict.status === "fail") {
            claimFail++;
            claimMessages.push(`${where}: ${verdict.reasons.join(" ")}`);
          } else if (verdict.status === "needs_review") {
            claimReview++;
            claimMessages.push(`${where}: ${verdict.reasons.join(" ")}`);
          }
          continue;
        }
        if (line.kind in expectedOffer) {
          if (expectedOffer[line.kind] !== line.text) {
            offerFail++;
            items.push({ check: "offer_accuracy", method: "automated", status: "fail", message: `${where}: "${line.text}" doesn't match the brief (expected ${expectedOffer[line.kind] ?? "nothing"}).` });
          }
          continue;
        }
        if (line.kind === "cta") {
          items.push(...ctaItems(line.text, lang, where, input));
        }
      }
    }
  });
  items.push(...ctaItems(input.outroCta.text, input.outroCta.lang, "Outro", input));

  items.push({
    check: "product_claim_accuracy",
    method: "automated",
    status: claimFail ? "fail" : claimReview ? "needs_review" : "pass",
    message: claimFail || claimReview ? claimMessages.join(" ") : "Every on-screen claim is a confirmed benefit from the brief.",
  });

  const issues = offerIssues(brief.offers, today);
  for (const iss of issues) items.push({ check: "offer_accuracy", method: "automated", status: iss.severity, message: iss.message });
  if (!offerFail && !issues.some((i) => i.severity === "fail")) {
    items.push({ check: "offer_accuracy", method: "automated", status: "pass", message: offer ? "Price, MRP and discount match the brief; discount recomputed." : "No price or offer shown." });
  }
  return items;
}

function ctaItems(text: string, lang: Lang, where: string, input: ComplianceInput): QaItem[] {
  const out: QaItem[] = [];
  const cats = classify(text).filter((c) => c !== "general");
  const approved = (input.approvedCtas[lang] ?? []).includes(text) || input.brief.cta[lang] === text;
  if (!approved) out.push({ check: "cta_presence", method: "automated", status: "fail", message: `${where}: CTA "${text}" isn't the brief's CTA.` });
  if (cats.length) {
    const v = evaluateClaim({ text, language: lang, confirmed: true, attested: false, testimonialConsent: false }, input.brief.offers);
    if (v.status !== "pass") out.push({ check: "cta_presence", method: "automated", status: v.status, message: `${where}: CTA wording — ${v.reasons.join(" ")}` });
  }
  return out;
}
