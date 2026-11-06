import { describe, it, expect, beforeAll } from "vitest";
import { seedBundledBrand, updateBrand, unlockBrand, assertBrandDeletable, getDefaultBrand, getBrand, createBrand, listBrands, setDefaultBrand, deleteBrand, brandForVersion } from "@/server/brand/kits";
import { BrandCreate } from "@/lib/brand";
import { versionView } from "@/server/views";
import { seedTemplates } from "@/server/planning/templates";
import { createAd, requireVersion } from "@/server/db/repos/versions";
import { forkVersion, deleteVersion, duplicateAd, deleteAd } from "@/server/db/repos/lifecycle";
import { collectGarbage } from "@/server/storage/gc";
import { putBuffer, getAsset } from "@/server/storage/assets";
import { db } from "@/server/db";

beforeAll(async () => {
  await seedBundledBrand();
  seedTemplates();
});

describe("brand kits (B1, B2)", () => {
  it("refuses edits without unlock and refuses deleting the default brand", () => {
    const b = getDefaultBrand()!;
    expect(() => updateBrand(b.id, { tagline: "x" })).toThrow(expect.objectContaining({ code: "BRAND_LOCKED", status: 423 }));
    expect(() => assertBrandDeletable(b.id)).toThrow(expect.objectContaining({ status: 409 }));
  });
  it("creates a new revision after unlock; existing versions keep theirs; relocks", () => {
    const b = getDefaultBrand()!;
    const { versionId } = createAd({ name: "brand test", templateKey: "product_showcase", platform: "instagram_reels" });
    const before = requireVersion(versionId).brand_revision_id;
    unlockBrand(b.id);
    const after = updateBrand(b.id, { approvedCtas: { en: ["Shop now on demandmesh.shop"], ml: ["demandmesh.shop-ൽ വാങ്ങൂ"], hi: [] }, note: "Add Malayalam CTA" });
    expect(after.revisionNumber).toBe(b.revisionNumber + 1);
    expect(after.tokens.colors.primary).toBe("#0C1C28"); // untouched fields carry over
    expect(after.logos.length).toBe(1);
    expect(requireVersion(versionId).brand_revision_id).toBe(before);
    expect(brandForVersion(versionId).revisionId).toBe(before);
    expect(() => updateBrand(b.id, { tagline: "y" })).toThrow(expect.objectContaining({ code: "BRAND_LOCKED" }));
  });
});

describe("multiple brands", () => {
  const input = (over: Partial<BrandCreate> = {}) => BrandCreate.parse({ name: "Kappa Coffee", website: "https://www.kappa.coffee/", primary: "#3B1F0E", secondary: "#8A5A2B", tagline: "Slow roasted.", ...over });

  it("validates website and colour contrast", () => {
    expect(input().website).toBe("kappa.coffee");
    expect(() => input({ website: "not a site" })).toThrow();
    const r = BrandCreate.safeParse({ name: "Sunny", website: "sunny.in", primary: "#FFE14D", secondary: "#526979" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/too light/);
  });

  it("creates a brand with a derived palette and wordmark, used by ads made with it", () => {
    const k = createBrand(input());
    expect(k.isDefault).toBe(false);
    expect(k.logos).toEqual([]);
    expect(k.tokens.colors).toMatchObject({ primary: "#3B1F0E", secondary: "#8A5A2B", white: "#FFFFFF" });
    expect(listBrands().map((b) => b.name)).toContain("Kappa Coffee");
    const { versionId, adId } = createAd({ name: "coffee", templateKey: "product_showcase", platform: "instagram_reels", brandId: k.id });
    expect(brandForVersion(versionId).id).toBe(k.id);
    expect(versionView(versionId).view.brand.name).toBe("Kappa Coffee");
    expect(versionView(versionId).view.brief.cta.en).toBe("Shop now on kappa.coffee");
    // Edit colours: the existing draft keeps revision 1 until a new version is forked.
    unlockBrand(k.id);
    updateBrand(k.id, { primary: "#1E3A2B", secondary: "#4F6B5A", note: "rebrand" });
    expect(brandForVersion(versionId).tokens.colors.primary).toBe("#3B1F0E");
    db().prepare("UPDATE ad_versions SET status = 'ready' WHERE id = ?").run(versionId);
    const f = forkVersion(versionId);
    expect(brandForVersion(f.versionId).tokens.colors.primary).toBe("#1E3A2B");
    deleteAd(adId);
  });

  it("switches the default and soft-deletes non-default brands", () => {
    const k = createBrand(input({ name: "Second" }));
    const first = getDefaultBrand()!;
    setDefaultBrand(k.id);
    expect(getDefaultBrand()!.id).toBe(k.id);
    expect(() => deleteBrand(k.id)).toThrow(expect.objectContaining({ code: "BRAND_IS_DEFAULT" }));
    setDefaultBrand(first.id);
    deleteBrand(k.id);
    expect(listBrands().some((b) => b.id === k.id)).toBe(false);
    expect(getBrand(k.id)).toBeDefined(); // still resolvable for old ads
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
    expect(getDefaultBrand()!.logos.length).toBe(1); // official logo is never collected
    expect(db().prepare("SELECT 1 FROM ads WHERE id = ?").get(adId)).toBeUndefined();
  });
});

describe("logo pinning (plan §3: old ads never change)", () => {
  it("an ad made before a logo change keeps the seeded logo of its revision", async () => {
    const b = getDefaultBrand()!;
    const seedLogo = b.logos[0]!;
    const { versionId } = createAd({ name: "logo pin", templateKey: "product_showcase", platform: "instagram_reels" });
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 320, height: 80, channels: 4, background: "#0C1C28" } }).png().toBuffer();
    const next = await putBuffer(png, { kind: "image", mime: "image/png", ext: "png", source: "upload", width: 320, height: 80 });
    unlockBrand(b.id);
    const after = updateBrand(b.id, { logoAssetId: next.id, note: "new logo" });
    expect(after.logos[0]?.assetId).toBe(next.id);
    const old = brandForVersion(versionId).logos[0]!;
    expect(old.assetId).toBe(seedLogo.assetId);
    expect(old.pinnedSha256).toBe(seedLogo.pinnedSha256);
  });
});
