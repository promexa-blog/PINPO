import { z } from "zod";

/** Creative brief (plan §4). Shared by the editor form and the server. Client-safe. */

export const Lang = z.enum(["en", "ml", "hi"]);
export type Lang = z.infer<typeof Lang>;
export const LANG_LABEL: Record<Lang, string> = { en: "English", ml: "Malayalam", hi: "Hindi" };

export const Category = z.enum(["fashion_accessories", "health_personal_care", "home_kitchen", "office_stationery"]);
export type Category = z.infer<typeof Category>;
export const CATEGORY_LABEL: Record<Category, string> = {
  fashion_accessories: "Fashion & Accessories",
  health_personal_care: "Health & Personal Care",
  home_kitchen: "Home & Kitchen",
  office_stationery: "Office & Stationery",
};

export const Tone = z.enum(["premium", "friendly", "energetic", "calm", "informative"]);
export const VisualStyle = z.enum(["studio", "lifestyle", "minimal", "bold"]);
export const Objective = z.enum(["awareness", "traffic", "sales", "group_buy"]);
export const PlatformKeySchema = z.enum(["instagram_reels", "instagram_story", "youtube_shorts", "instagram_feed", "facebook_feed", "youtube_instream"]);

export const ClaimCategory = z.enum(["general", "medical_health", "safety", "performance", "comparative", "environmental", "testimonial", "urgency", "pricing"]);
export type ClaimCategory = z.infer<typeof ClaimCategory>;

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const assetId = z.string().regex(/^ast_[a-f0-9]{20}$/);

export const ClaimInput = z.object({
  id: z.string().regex(/^clm_[a-f0-9]{20}$/).optional(),
  language: Lang,
  text: text(160).min(1, "Write the benefit"),
  /** "I confirm this is true for this product." */
  confirmed: z.boolean().default(false),
  source: text(300).optional().nullable(),
  /** Evidence for regulated claims: document, URL or certificate reference. */
  substantiation: text(500).optional().nullable(),
  /** Separate human attestation for regulated claim categories. */
  attested: z.boolean().default(false),
  /** Testimonials only: customer gave permission. */
  testimonialConsent: z.boolean().default(false),
});
export type ClaimInput = z.infer<typeof ClaimInput>;

export const OffersInput = z
  .object({
    priceInr: z.number().positive().max(10_000_000).optional().nullable(),
    mrpInr: z.number().positive().max(10_000_000).optional().nullable(),
    validUntil: isoDate.optional().nullable(),
    terms: text(200).optional().nullable(),
    /** e.g. "Only 20 units in this batch" — needed before any "limited stock" wording. */
    stockStatement: text(120).optional().nullable(),
    stockConfirmed: z.boolean().default(false),
    groupBuy: z
      .object({
        groupPriceInr: z.number().positive().max(10_000_000),
        minBuyers: z.number().int().min(2).max(100_000),
        deadline: isoDate,
      })
      .optional()
      .nullable(),
    /** When the price was last confirmed (plan: >7 days at export → needs review). */
    confirmedOn: isoDate.optional().nullable(),
  })
  .superRefine((o, ctx) => {
    if (o.priceInr && o.mrpInr && o.mrpInr < o.priceInr) ctx.addIssue({ code: "custom", path: ["mrpInr"], message: "MRP can't be lower than the selling price." });
    if (o.mrpInr && !o.priceInr) ctx.addIssue({ code: "custom", path: ["priceInr"], message: "Add the selling price to show an MRP." });
  });
export type OffersInput = z.infer<typeof OffersInput>;

export const BriefInput = z.object({
  product: z.object({
    /** May be empty while drafting; Generate requires it (checkDraft). */
    name: text(80),
    category: Category,
    /** Appearance lock text: colour, material, size/dimensions, packaging, branding on the product. */
    appearance: text(600),
    productUrl: z.string().url().max(300).optional().nullable(),
    imageAssetIds: z.array(assetId).max(9).default([]),
  }),
  audience: z.object({
    who: text(200),
    location: text(100).default("Kerala, India"),
  }),
  campaign: z.object({ objective: Objective, platform: PlatformKeySchema }),
  claims: z.array(ClaimInput).max(12).default([]),
  offers: OffersInput.default({ stockConfirmed: false }),
  cta: z.object({ en: text(60).optional(), ml: text(80).optional(), hi: text(80).optional() }),
  creative: z.object({ direction: text(500).default(""), tone: Tone, style: VisualStyle }),
  languages: z.array(Lang).min(1).max(3).default(["en"]),
});
export type BriefInput = z.infer<typeof BriefInput>;
