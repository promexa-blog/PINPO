import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { paths } from "@/server/paths";
import { renderer } from "@/server/render/browser";
import { seedBundledBrand, createBrand, type Brand } from "@/server/brand/kits";
import { BrandCreate } from "@/lib/brand";
import { renderOutro, renderOverlay, type OutroType } from "@/server/render/brand-render";
import { storeUpload } from "@/server/storage/upload";
import { UploadMeta } from "@/lib/schemas";
import type { PlatformKey } from "@/lib/platforms";

/**
 * Snapshot tests for brand rendering (plan tests L1, O1). References live in
 * tests/fixtures/render-refs and were visually approved; regenerate with UPDATE_RENDER_REFS=1
 * (then review the images before committing). Pinned Chrome makes renders deterministic.
 */

const REFS = path.resolve("tests/fixtures/render-refs");
const out = path.join(paths.work, "snapshots");
let brand: Brand;
let productId: string;

async function compare(name: string, file: string) {
  const ref = path.join(REFS, `${name}.png`);
  if (process.env.UPDATE_RENDER_REFS === "1" || !existsSync(ref)) {
    mkdirSync(REFS, { recursive: true });
    copyFileSync(file, ref);
    if (process.env.UPDATE_RENDER_REFS !== "1") throw new Error(`Missing reference ${name}.png — created it; review and commit.`);
    return;
  }
  const [a, b] = await Promise.all([sharp(file).raw().toBuffer({ resolveWithObject: true }), sharp(ref).raw().toBuffer({ resolveWithObject: true })]);
  expect([a.info.width, a.info.height]).toEqual([b.info.width, b.info.height]);
  let differing = 0;
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    let d = 0;
    for (let c = 0; c < a.info.channels; c++) d = Math.max(d, Math.abs(a.data[i + c]! - b.data[i + c]!));
    if (d > 8) differing++;
  }
  expect(differing / (a.info.width * a.info.height), `${name} differs from its approved reference`).toBeLessThanOrEqual(0.005);
}

beforeAll(async () => {
  mkdirSync(out, { recursive: true });
  brand = (await seedBundledBrand())!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect x="150" y="100" width="500" height="800" rx="50" fill="#b8c1c8"/><rect x="150" y="380" width="500" height="14" fill="#7f8c95"/><rect x="320" y="30" width="160" height="90" rx="16" fill="#1b2631"/></svg>`;
  const png = await sharp({ create: { width: 800, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  productId = (await storeUpload(png, "p.png", UploadMeta.parse({ purpose: "product_image", provenance: { sourceType: "own_photo", commercialUse: "yes", permissionConfirmed: true } }))).id;
});
afterAll(async () => renderer.close());

describe("Malayalam and Hindi shaping (L1)", () => {
  const corpus: { name: string; lang: "ml" | "hi"; text: string }[] = [
    { name: "shaping-ml-conjuncts", lang: "ml", text: "ക്ഷ ന്റ ന്ത ശ്ര സ്ത്ര ഒരുമിച്ച് വാങ്ങൂ" },
    { name: "shaping-ml-chillu", lang: "ml", text: "ൾ ൻ ൽ ർ ൺ — കുറഞ്ഞ വിലയിൽ" },
    { name: "shaping-hi-conjuncts", lang: "hi", text: "क्ष त्र ज्ञ श्र द्ध — साथ खरीदें" },
    { name: "shaping-hi-reph-nukta", lang: "hi", text: "र्क र्म क़ ज़ फ़ — कम कीमत में" },
  ];
  for (const c of corpus) {
    it(`renders ${c.name} identically to the approved reference`, async () => {
      const file = path.join(out, `${c.name}.png`);
      await renderOverlay({ brand, platform: "instagram_feed", lang: c.lang, layout: "centered", lines: [{ kind: "claim", text: c.text }], outFile: file });
      await compare(c.name, file);
    }, 60_000);
  }
});

describe("DemandMesh outro presets (O1)", () => {
  const cases: { type: OutroType; platform: PlatformKey; lang: "en" | "ml" | "hi"; cta: string }[] = [
    { type: "standard", platform: "instagram_reels", lang: "en", cta: "Shop now on demandmesh.shop" },
    { type: "standard", platform: "youtube_instream", lang: "en", cta: "Shop now on demandmesh.shop" },
    { type: "standard", platform: "instagram_feed", lang: "ml", cta: "demandmesh.shop-ൽ വാങ്ങൂ" },
    { type: "standard", platform: "instagram_reels", lang: "hi", cta: "demandmesh.shop पर खरीदें" },
    { type: "promotional", platform: "instagram_reels", lang: "en", cta: "Shop now on demandmesh.shop" },
    { type: "product", platform: "instagram_reels", lang: "en", cta: "Shop now on demandmesh.shop" },
    { type: "minimal", platform: "instagram_feed", lang: "en", cta: "Shop now" },
  ];
  for (const c of cases) {
    const name = `outro-${c.type}-${c.platform}-${c.lang}`;
    it(`renders ${name} identically to the approved reference`, async () => {
      const file = path.join(out, `${name}.png`);
      await renderOutro({
        brand,
        platform: c.platform,
        lang: c.lang,
        type: c.type,
        cta: c.cta,
        offerLines: [{ kind: "offer_price", text: "₹899" }, { kind: "offer_mrp", text: "₹1,299" }, { kind: "offer_discount", text: "30% off" }, { kind: "offer_validity", text: "Offer valid till 30 Nov 2026" }],
        product: { assetId: productId, name: "Steel Lunch Box", price: "₹899" },
        outFile: file,
      });
      await compare(name, file);
    }, 60_000);
  }

  it("promotional outro refuses to render without an offer", async () => {
    await expect(renderOutro({ brand, platform: "instagram_reels", lang: "en", type: "promotional", cta: "Shop now", offerLines: [], outFile: path.join(out, "x.png") })).rejects.toMatchObject({ code: "OUTRO_NEEDS_OFFER" });
  });

  it("renders a brand without a logo as a wordmark in its own colours (any brand)", async () => {
    const k = createBrand(BrandCreate.parse({ name: "Kappa Coffee", website: "kappa.coffee", primary: "#3B1F0E", secondary: "#8A5A2B", tagline: "Slow roasted." }));
    for (const type of ["standard", "minimal"] as const) {
      const file = path.join(out, `wordmark-${type}.png`);
      await renderOutro({ brand: k, platform: "instagram_reels", lang: "en", type, cta: "Order on kappa.coffee", offerLines: [], outFile: file });
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([1080, 1920]);
      // The wordmark is set in the brand primary (#3B1F0E): some pixels must be (close to) it.
      let brandInk = 0;
      for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i]! - 0x3b) < 6 && Math.abs(data[i + 1]! - 0x1f) < 6 && Math.abs(data[i + 2]! - 0x0e) < 6) brandInk++;
      expect(brandInk).toBeGreaterThan(2000);
    }
  }, 60_000);
});
