import "../guard";
import type { ClaimCategory, Lang, OffersInput } from "@/lib/brief";

/**
 * Advertising-claim classifier (plan §9 [v2.2]). Keyword/pattern lists per category in English,
 * Malayalam and Hindi. This reduces risk; it is NOT legal review (see README: ASCI code,
 * Consumer Protection rules).
 */

const P = (parts: string[]) => new RegExp(parts.join("|"), "iu");

export const PATTERNS: Record<Exclude<ClaimCategory, "general">, RegExp> = {
  medical_health: P([
    "\\bcur(e|es|ed|ing)\\b", "\\btreat(s|ed|ing|ment)?\\b", "\\bheal(s|ed|ing)?\\b", "\\bprevent(s|ed|ing)?\\b.{0,30}\\b(disease|infection|illness|virus|cancer|diabetes)",
    "\\btherapeutic\\b", "\\bimmun(e|ity)\\b", "\\bweight[- ]?loss\\b", "\\blose weight\\b", "\\bfat[- ]?burn", "\\bclinically\\b",
    "\\b(doctor|dermatologist|dentist|physician)s?[- ](recommended|approved|tested)\\b", "\\bFDA\\b", "\\bAYUSH\\b", "\\bmedicated\\b",
    "\\banti[- ]?(bacterial|viral|fungal|ageing|aging)\\b", "\\bkills?\\b.{0,20}(germs|bacteria|virus)", "\\bacne\\b", "\\bhair ?fall\\b", "\\bhair growth\\b",
    "\\bdiabet", "\\bcancer\\b", "\\bpain relief\\b",
    // Malayalam
    "രോഗ", "ചികിത്സ", "സുഖപ്പെടുത്ത", "പ്രതിരോധ", "ഡോക്ടർ", "ഭാരം കുറയ്ക്ക",
    // Hindi
    "इलाज", "रोग", "बीमारी", "डॉक्टर", "प्रतिरक्षा", "इम्युनिटी", "वजन घटा", "उपचार",
  ]),
  safety: P([
    "\\b100\\s?% ?safe\\b", "\\bcompletely safe\\b", "\\btotally safe\\b", "\\bno side[- ]?effects?\\b", "\\bside[- ]?effect[- ]?free\\b",
    "\\bchemical[- ]?free\\b", "\\bnon[- ]?toxic\\b", "\\bchild[- ]?safe\\b", "\\bbaby[- ]?safe\\b", "\\bharmless\\b",
    "സുരക്ഷിത", "പാർശ്വഫല",
    "सुरक्षित", "साइड इफेक्ट", "दुष्प्रभाव", "केमिकल फ्री", "हानिरहित",
  ]),
  performance: P([
    "\\d+(\\.\\d+)?\\s?(%|x\\b|times\\b|hours?\\b|hrs?\\b|days?\\b|mah\\b|watts?\\b|years?\\b)", "\\bguarantee(d)?\\b", "\\blasts?\\b.{0,20}\\b(hours?|days?|years?)",
    "\\b\\d+x faster\\b", "\\bfaster than\\b", "\\blong[- ]lasting\\b", "\\bwaterproof\\b", "\\bunbreakable\\b",
    "ഗ്യാരണ്ടി", "മണിക്കൂർ",
    "गारंटी", "घंटे", "वाटरप्रूफ",
  ]),
  comparative: P([
    "\\bbest\\b", "#\\s?1\\b", "\\bno\\.?\\s?1\\b", "\\bnumber one\\b", "\\blowest price\\b", "\\bcheapest\\b", "\\bbetter than\\b",
    "\\btop[- ]rated\\b", "\\bunbeatable\\b", "\\bworld'?s (best|first|finest)\\b", "\\bonly one\\b", "\\bmarket leader\\b",
    "ഏറ്റവും മികച്ച", "ഏറ്റവും കുറഞ്ഞ", "ഒന്നാം നമ്പർ",
    "सबसे अच्छा", "सबसे बढ़िया", "सबसे सस्ता", "नंबर 1", "नंबर वन",
  ]),
  environmental: P([
    "\\beco[- ]?friendly\\b", "\\bbiodegradable\\b", "\\borganic\\b", "\\bsustainabl", "\\bplastic[- ]?free\\b", "\\brecyclable\\b",
    "\\bcarbon[- ]?neutral\\b", "\\bcompostable\\b", "\\bgreen product\\b",
    "ജൈവ", "പരിസ്ഥിതി സൗഹൃദ",
    "ऑर्गेनिक", "जैविक", "पर्यावरण", "इको फ्रेंडली",
  ]),
  testimonial: P([
    "★", "⭐", "\\b\\d(\\.\\d)?\\s?(/\\s?5|out of 5|stars?)\\b", "\\brated\\b", "\\breviews?\\b", "\\btestimonial", "\\bcustomers? (love|say|rate|trust)",
    "[“\"][^”\"]{8,}[”\"]", "\\b\\d+[,\\d]*\\s?(k|\\+)?\\s?(happy )?(customers|users|buyers|families)\\b", "\\bloved by\\b", "\\btrusted by\\b",
    "ഉപഭോക്താക്കൾ", "റിവ്യൂ",
    "ग्राहक", "रिव्यू", "समीक्षा",
  ]),
  urgency: P([
    "\\bonly today\\b", "\\btoday only\\b", "\\blast chance\\b", "\\blimited (stock|time|period|offer|edition|units?)\\b", "\\bhurry\\b",
    "\\bends? (soon|today|tonight)\\b", "\\bwhile stocks? lasts?\\b", "\\bcountdown\\b", "\\bfew (left|remaining)\\b", "\\bselling fast\\b",
    "\\bdon'?t miss\\b", "\\bact now\\b", "\\blast \\d+ (units?|pieces?|hours?)\\b",
    "ഇന്ന് മാത്രം", "പരിമിത", "വേഗം",
    "आज ही", "सिर्फ आज", "सीमित", "जल्दी करें", "जल्दी",
  ]),
  pricing: P([
    "₹", "\\brs\\.?\\s?\\d", "\\binr\\b", "\\d+\\s?%\\s?off\\b", "\\bdiscount", "\\bsale price\\b", "\\bmrp\\b", "\\bfree\\b", "\\bcashback\\b", "\\bbogo\\b", "\\bbuy \\d+ get \\d+\\b",
    "കിഴിവ്", "സൗജന്യ",
    "छूट", "मुफ्त", "फ्री",
  ]),
};

/** Categories needing substantiation + a separate human attestation (plan §9). */
export const SUBSTANTIATED: ReadonlySet<ClaimCategory> = new Set(["medical_health", "safety", "performance", "comparative", "environmental"]);

const URGENCY_STOCK = /limited (stock|units?)|few (left|remaining)|while stocks? lasts?|last \d+ (units?|pieces?)|selling fast/iu;

export function classify(text: string): ClaimCategory[] {
  const cats = (Object.keys(PATTERNS) as Exclude<ClaimCategory, "general">[]).filter((c) => PATTERNS[c].test(text));
  return cats.length ? cats : ["general"];
}

/** Most restrictive category first; used as the claim's stored category. */
const SEVERITY: ClaimCategory[] = ["medical_health", "testimonial", "safety", "performance", "comparative", "environmental", "urgency", "pricing", "general"];
export function primaryCategory(cats: ClaimCategory[]): ClaimCategory {
  return SEVERITY.find((c) => cats.includes(c)) ?? "general";
}

export interface ClaimLike {
  text: string;
  language: Lang;
  confirmed: boolean;
  source?: string | null;
  substantiation?: string | null;
  attested: boolean;
  testimonialConsent: boolean;
}

export type ComplianceStatus = "pass" | "needs_review" | "fail";

export interface ClaimVerdict {
  categories: ClaimCategory[];
  status: ComplianceStatus;
  reasons: string[];
}

/**
 * Evaluates one claim against the v2.2 rules. Unconfirmed claims never pass; regulated
 * categories need substantiation + attestation and then still go to human review.
 */
export function evaluateClaim(c: ClaimLike, offers: OffersInput): ClaimVerdict {
  const categories = classify(c.text);
  const reasons: string[] = [];
  let status: ComplianceStatus = "pass";
  const worsen = (s: ComplianceStatus) => {
    if (s === "fail" || (s === "needs_review" && status === "pass")) status = s;
  };
  if (!c.confirmed) {
    worsen("fail");
    reasons.push("Not confirmed as true for this product.");
  }
  for (const cat of categories) {
    if (SUBSTANTIATED.has(cat)) {
      if (!c.substantiation?.trim() || !c.attested) {
        worsen("fail");
        reasons.push(`${label(cat)} claims need evidence (document, URL or certificate) and your separate confirmation.`);
      } else {
        worsen("needs_review");
        reasons.push(`${label(cat)} claim — review the evidence before export.`);
      }
    }
    if (cat === "testimonial") {
      if (!c.source?.trim() || !c.testimonialConsent) {
        worsen("fail");
        reasons.push("Reviews, ratings and testimonials need a real source and the customer's permission.");
      } else {
        worsen("needs_review");
        reasons.push("Testimonial — check the source and permission before export.");
      }
    }
    if (cat === "urgency") {
      const stockWording = URGENCY_STOCK.test(c.text);
      if (stockWording && !(offers.stockConfirmed && offers.stockStatement?.trim())) {
        worsen("fail");
        reasons.push('"Limited stock" wording needs a confirmed stock statement in Price & offers.');
      }
      if (!stockWording && !offers.validUntil) {
        worsen("fail");
        reasons.push("Time-limited wording needs an offer end date in Price & offers.");
      }
    }
    if (cat === "pricing") {
      worsen("fail");
      reasons.push("Prices and discounts must come from Price & offers, not from benefit text.");
    }
  }
  return { categories, status, reasons };
}

function label(cat: ClaimCategory): string {
  return (
    {
      general: "General",
      medical_health: "Medical/health",
      safety: "Safety",
      performance: "Performance",
      comparative: "Comparative",
      environmental: "Environmental",
      testimonial: "Testimonial",
      urgency: "Urgency",
      pricing: "Pricing",
    } as const
  )[cat];
}

/** Prompts may never ask the video model to invent endorsements (plan §9, test M5). */
const TESTIMONIAL_PROMPT = /(customer|client|user|buyer|person|people)s?\b.{0,40}\b(review|testimonial|rating|endorse|recommend)|giving (a )?(review|testimonial|thumbs up to the camera)|star ratings?|holding (a )?(sign|review)|five[- ]star/iu;
export function isEndorsementPrompt(prompt: string): boolean {
  return TESTIMONIAL_PROMPT.test(prompt);
}
