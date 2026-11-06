import { describe, it, expect, beforeAll } from "vitest";
import { seedMasterBrand, updateBrandCopy, unlockBrand, assertBrandDeletable, getMasterBrand } from "@/server/brand/master";
import { seedTemplates } from "@/server/planning/templates";
import { createAd, requireVersion } from "@/server/db/repos/versions";
import { forkVersion, deleteVersion, duplicateAd, deleteAd } from "@/server/db/repos/lifecycle";
import { collectGarbage } from "@/server/storage/gc";
import { putBuffer, getAsset } from "@/server/storage/assets";
import { db } from "@/server/db";

beforeAll(async () => {
  await seedMasterBrand();
  seedTemplates();
});

describe("protected master brand (B1, B2)", () => {
  it("refuses edits without unlock and refuses deletion", () => {
    const b = getMasterBrand()!;
    expect(() => updateBrandCopy(b.id, { tagline: "x" })).toThrow(expect.objectContaining({ code: "BRAND_LOCKED", status: 423 }));
    expect(() => assertBrandDeletable(b.id)).toThrow(expect.objectContaining({ status: 409 }));
  });
  it("creates a new revision after unlock; existing versions keep theirs; relocks", () => {
    const b = getMasterBrand()!;
    const { versionId } = createAd({ name: "brand test", templateKey: "product_showcase", platform: "instagram_reels" });
    const before = requireVersion(versionId).brand_revision_id;
    unlockBrand(b.id);
    const after = updateBrandCopy(b.id, { approvedCtas: { en: ["Shop now on demandmesh.shop"], ml: ["demandmesh.shop-ൽ വാങ്ങൂ"], hi: [] }, note: "Add Malayalam CTA" });
    expect(after.revisionNumber).toBe(b.revisionNumber + 1);
    expect(after.tokens.colors.primary).toBe("#0C1C28"); // identity untouched
    expect(requireVersion(versionId).brand_revision_id).toBe(before);
    expect(() => updateBrandCopy(b.id, { tagline: "y" })).toThrow(expect.objectContaining({ code: "BRAND_LOCKED" }));
  });
});

describe("version lifecycle", () => {
  it("forks into one draft, refuses deleting current/draft-only, duplicates and soft-deletes", () => {
    const { adId, versionId } = createAd({ name: "life", templateKey: "product_showcase", platform: "instagram_reels" });
    expect(forkVersion(versionId)).toEqual({ versionId, created: false }); // already a draft
    db().prepare("UPDATE ad_versions SET status = 'ready' WHERE id = ?").run(versionId);
    const f = forkVersion(versionId);
    expect(f.created).toBe(true);
    expect(requireVersion(f.versionId).number).toBe(2);
    expect(requireVersion(f.versionId).parent_version_id).toBe(versionId);
    expect(() => deleteVersion(f.versionId)).toThrow(/current/);
    deleteVersion(versionId);
    expect(db().prepare("SELECT 1 FROM ad_versions WHERE id = ?").get(versionId)).toBeUndefined();
    const dup = duplicateAd(adId);
    expect(requireVersion(dup.versionId).status).toBe("draft");
    deleteAd(adId);
    expect((db().prepare("SELECT deleted_at FROM ads WHERE id = ?").get(adId) as { deleted_at: number }).deleted_at).toBeGreaterThan(0);
  });

  it("garbage-collects unreferenced assets after 24 h and purges ads deleted > 7 days ago", async () => {
    const orphan = await putBuffer(Buffer.from(`orphan-${Math.random()}`), { kind: "document", mime: "text/plain", ext: "txt", source: "derived" });
    const { adId } = createAd({ name: "old", templateKey: "product_showcase", platform: "instagram_reels" });
    db().prepare("UPDATE ads SET deleted_at = ? WHERE id = ?").run(Date.now() - 8 * 86_400_000, adId);
    const r = await collectGarbage(Date.now() + 2 * 86_400_000);
    expect(r.purgedAds).toBeGreaterThanOrEqual(1);
    expect(getAsset(orphan.id)).toBeUndefined();
    expect(getMasterBrand()!.logos.length).toBe(1); // official logo is never collected
    expect(db().prepare("SELECT 1 FROM ads WHERE id = ?").get(adId)).toBeUndefined();
  });
});
