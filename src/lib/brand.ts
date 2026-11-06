import { z } from "zod";
import { HEX, WEBSITE, normalizeWebsite, paletteProblems } from "./color";

/** Client-safe brand-kit input schemas (create + edit share the same field rules). */

const ctaList = z.array(z.string().trim().min(1).max(80)).max(10);

const fields = {
  name: z.string().trim().min(1, "Give the brand a name.").max(60),
  website: z
    .string()
    .max(120)
    .transform(normalizeWebsite)
    .refine((v) => WEBSITE.test(v), "Enter a website like yourshop.com — it's shown on every outro."),
  tagline: z.string().trim().max(80),
  primary: z.string().trim().regex(HEX, "Use a hex colour like #0C1C28."),
  secondary: z.string().trim().regex(HEX, "Use a hex colour like #526979."),
  /** Uploaded logo asset (purpose "brand_logo"), or null for a text wordmark. */
  logoAssetId: z.string().min(1).max(64).nullable(),
  approvedCtas: z.object({ en: ctaList, ml: ctaList, hi: ctaList }),
  groupBuyLine: z.string().trim().max(80),
  social: z.record(z.string().max(20), z.string().trim().max(60)),
};

export const BrandCreate = z
  .object({
    ...fields,
    tagline: fields.tagline.default(""),
    logoAssetId: fields.logoAssetId.default(null),
    approvedCtas: fields.approvedCtas.default({ en: [], ml: [], hi: [] }),
    groupBuyLine: fields.groupBuyLine.default(""),
    social: fields.social.default({}),
  })
  .superRefine((b, ctx) => {
    for (const message of paletteProblems(b.primary, b.secondary)) ctx.addIssue({ code: "custom", path: ["primary"], message });
  });
export type BrandCreate = z.infer<typeof BrandCreate>;

export const BrandPatch = z
  .object({ ...fields, note: z.string().trim().max(200) })
  .partial()
  .superRefine((b, ctx) => {
    if ((b.primary === undefined) !== (b.secondary === undefined)) ctx.addIssue({ code: "custom", path: ["primary"], message: "Send both colours together." });
    if (b.primary && b.secondary) for (const message of paletteProblems(b.primary, b.secondary)) ctx.addIssue({ code: "custom", path: ["primary"], message });
  });
export type BrandPatch = z.infer<typeof BrandPatch>;

/** Light row for brand pickers and the brand list. */
export interface BrandSummary {
  id: string;
  name: string;
  isDefault: boolean;
  website: string;
  tagline: string;
  primary: string;
  secondary: string;
  logoAssetId: string | null;
  revisionNumber: number;
  adCount: number;
}
