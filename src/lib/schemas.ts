import { z } from "zod";

/** Shared (client + server) validation schemas. No server imports here. */

export const UploadPurpose = z.enum(["product_image", "frame_image", "music", "voiceover"]);
export type UploadPurpose = z.infer<typeof UploadPurpose>;

export const CommercialUse = z.enum(["yes", "no", "unknown"]);
export const SourceType = z.enum([
  "official_brand",
  "product_supplier",
  "own_photo",
  "stock_licensed",
  "commissioned",
  "recorded_voice",
  "generated_fal",
  "rendered",
  "font",
]);

const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const ProvenanceInput = z.object({
  sourceType: SourceType,
  origin: optText(500),
  license: optText(200),
  commercialUse: CommercialUse,
  attributionText: optText(300),
  rightsHolder: optText(200),
  licenseExpiresAt: z.number().int().positive().optional().nullable(),
  talentConsent: z.boolean().optional(),
  proofNote: optText(500),
  /** Product images: "I have permission to use this image in DemandMesh ads." */
  permissionConfirmed: z.boolean().optional(),
});
export type ProvenanceInput = z.infer<typeof ProvenanceInput>;

/** Plan §8a: which provenance answers are mandatory for each upload purpose. */
export const UploadMeta = z
  .object({ purpose: UploadPurpose, provenance: ProvenanceInput })
  .superRefine(({ purpose, provenance: p }, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (!cond) ctx.addIssue({ code: "custom", path: ["provenance", path], message });
    };
    if (purpose === "music" || purpose === "voiceover") {
      need(!!p.license, "license", "Licence is required for music and voiceover.");
      need(p.commercialUse !== undefined, "commercialUse", "Say whether commercial use is allowed.");
    }
    if (purpose === "voiceover") {
      need(p.sourceType === "recorded_voice" || p.sourceType === "stock_licensed" || p.sourceType === "commissioned", "sourceType", "Voiceovers must be recorded, commissioned or licensed stock.");
      need(typeof p.talentConsent === "boolean", "talentConsent", "Confirm whether the voice talent consented to commercial ad use.");
    }
    if (purpose === "product_image") {
      need(p.sourceType === "own_photo" || p.sourceType === "product_supplier", "sourceType", "Product images must be your own photo or from the product supplier.");
      need(p.permissionConfirmed === true, "permissionConfirmed", "Confirm you have permission to use this image in DemandMesh ads.");
    }
    if (p.attributionText === undefined && /CC BY/i.test(p.license ?? "")) {
      need(false, "attributionText", "This licence requires an attribution credit.");
    }
  });
export type UploadMeta = z.infer<typeof UploadMeta>;

export const UPLOAD_LIMITS = {
  imageMaxBytes: 10 * 1024 * 1024,
  imageMinSide: 300,
  imageMaxPixels: 40_000_000,
  audioMaxBytes: 20 * 1024 * 1024,
  audioMaxSeconds: 600,
} as const;
