import { describe, it, expect, afterEach } from "vitest";
import sharp from "sharp";
import { putBuffer, absolutePath, getAsset } from "@/server/storage/assets";
import { assertDiskSpace, __setFreeBytesForTests, GB } from "@/server/storage/disk";
import { storeUpload } from "@/server/storage/upload";
import { UploadMeta } from "@/lib/schemas";

const productMeta = UploadMeta.parse({ purpose: "product_image", provenance: { sourceType: "own_photo", commercialUse: "yes", permissionConfirmed: true } });

afterEach(() => __setFreeBytesForTests(null));

describe("content-addressed storage", () => {
  it("dedupes identical bytes and keeps paths inside storage", async () => {
    const a = await putBuffer(Buffer.from("hello"), { kind: "document", mime: "text/plain", ext: "txt", source: "derived" });
    const b = await putBuffer(Buffer.from("hello"), { kind: "document", mime: "text/plain", ext: "txt", source: "derived" });
    expect(b.id).toBe(a.id);
    expect(absolutePath(a)).toContain(a.sha256);
    expect(() => absolutePath({ path: "../../etc/passwd" })).toThrow(/escapes/);
  });

  it("blocks work when disk space is low (I13)", async () => {
    __setFreeBytesForTests(0.5 * GB);
    await expect(assertDiskSpace(100 * 1024 * 1024)).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE", status: 507 });
    __setFreeBytesForTests(50 * GB);
    await expect(assertDiskSpace(100 * 1024 * 1024)).resolves.toBeUndefined();
  });
});

describe("uploads (A3, P3, P4)", () => {
  it("re-encodes product photos to sRGB PNG without resizing and records provenance", async () => {
    const jpg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#c0392b" } }).jpeg().toBuffer();
    const asset = await storeUpload(jpg, "red.jpg", productMeta);
    expect(asset.mime).toBe("image/png");
    expect([asset.width, asset.height]).toEqual([640, 480]);
    expect(asset.commercial_use).toBe("yes");
    expect(getAsset(asset.id)?.source_type).toBe("own_photo");
  });

  it("converts a Display-P3 image to sRGB (P3)", async () => {
    const p3 = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#00ff00" } }).withIccProfile("p3").png().toBuffer();
    const asset = await storeUpload(p3, "p3.png", productMeta);
    expect(asset.icc_profile).toMatch(/^embedded/);
    const meta = await sharp(absolutePath(asset)).metadata();
    expect(meta.space).toBe("srgb");
  });

  it("rejects tiny images, SVG and oversized files", async () => {
    const tiny = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(storeUpload(tiny, "t.png", productMeta)).rejects.toMatchObject({ code: "IMAGE_TOO_SMALL" });
    await expect(storeUpload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>      "), "x.svg", productMeta)).rejects.toMatchObject({ status: 415 });
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(11 * 1024 * 1024)]);
    await expect(storeUpload(huge, "h.jpg", productMeta)).rejects.toMatchObject({ status: 413 });
  });

  it("requires rights answers for music and voiceover (PV1)", () => {
    expect(UploadMeta.safeParse({ purpose: "music", provenance: { sourceType: "stock_licensed", commercialUse: "unknown" } }).success).toBe(false);
    expect(UploadMeta.safeParse({ purpose: "voiceover", provenance: { sourceType: "recorded_voice", license: "Owned", commercialUse: "yes" } }).success).toBe(false);
    expect(UploadMeta.safeParse({ purpose: "voiceover", provenance: { sourceType: "recorded_voice", license: "Owned", commercialUse: "yes", talentConsent: true } }).success).toBe(true);
    expect(UploadMeta.safeParse({ purpose: "product_image", provenance: { sourceType: "stock_licensed", commercialUse: "yes", permissionConfirmed: true } }).success).toBe(false);
  });
});
