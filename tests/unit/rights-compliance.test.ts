import { describe, it, expect } from "vitest";
import { rightsItems, creditsText, type UsedAsset } from "@/server/qa/checks/rights";
import { complianceItems } from "@/server/qa/checks/compliance";
import type { AssetRow } from "@/server/storage/assets";
import { BriefInput } from "@/lib/brief";

const asset = (over: Partial<AssetRow>): AssetRow => ({
  id: "ast_" + Math.random().toString(16).slice(2, 22).padEnd(20, "0"),
  sha256: "x", kind: "audio", mime: "audio/mpeg", bytes: 1, width: null, height: null, duration_s: 10, path: "assets/x", source: "upload",
  original_name: "track.mp3", official: 0, temporary: 0, source_type: "stock_licensed", origin: "Artlist #123", license: "Royalty-free (stock)",
  commercial_use: "yes", attribution_text: null, rights_holder: "Some Artist", license_expires_at: null, talent_consent: 0, proof_note: null, icc_profile: null, created_at: 0,
  ...over,
});

describe("asset rights gate (PV2, PV3, PV4)", () => {
  it("fails on no-commercial-use and expired licences; needs review when unknown", () => {
    const fail = rightsItems([{ asset: asset({ commercial_use: "no" }), role: "music" }]);
    expect(fail[0]).toMatchObject({ status: "fail" });
    const expired = rightsItems([{ asset: asset({ license_expires_at: Date.parse("2026-01-01") }), role: "music" }], Date.parse("2026-11-06"));
    expect(expired[0]!.message).toMatch(/expired/);
    expect(rightsItems([{ asset: asset({ commercial_use: "unknown" }), role: "music" }])[0]).toMatchObject({ status: "needs_review" });
  });
  it("fails a voiceover without voice-artist consent and a CC BY asset without credit", () => {
    expect(rightsItems([{ asset: asset({ source_type: "recorded_voice", talent_consent: 0 }), role: "voiceover" }])[0]!.message).toMatch(/consent/);
    expect(rightsItems([{ asset: asset({ license: "CC BY 4.0", attribution_text: null }), role: "music" }])[0]!.message).toMatch(/credit line/);
  });
  it("passes clean assets and writes credits for attributed/third-party assets (PV4)", () => {
    const used: UsedAsset[] = [
      { asset: asset({ attribution_text: "Music: “Sunrise” by Some Artist (CC BY 4.0)", license: "CC BY 4.0" }), role: "music" },
      { asset: asset({ source_type: "own_photo", license: "Owned by DemandMesh", rights_holder: "DemandMesh", original_name: "box.png" }), role: "product" },
    ];
    expect(rightsItems(used)[0]).toMatchObject({ status: "pass" });
    const txt = creditsText(used, "Lunch box (v1)");
    expect(txt).toContain("Music: “Sunrise” by Some Artist (CC BY 4.0)");
    expect(txt).not.toContain("box.png"); // own photo — no third-party credit
  });
});

describe("on-screen claim compliance (Q1)", () => {
  const brief = BriefInput.parse({
    product: { name: "Steel Lunch Box", category: "home_kitchen", appearance: "a brushed steel lunch box", imageAssetIds: [] },
    audience: { who: "office workers" },
    campaign: { objective: "sales", platform: "instagram_reels" },
    claims: [{ id: "clm_00000000000000000001", language: "en", text: "Keeps food apart", confirmed: true }],
    offers: { priceInr: 899, mrpInr: 1299, confirmedOn: "2026-11-06" },
    cta: { en: "Shop now on demandmesh.shop" },
    creative: { tone: "friendly", style: "lifestyle" },
  });
  const run = (lines: { kind: string; text: string; claimId?: string }[]) =>
    complianceItems({
      brief,
      scenes: [{ prompt: "", sceneType: "product_original", overlay: { layout: "lower_third", motion: "fade-up", byLang: { en: lines as never } } }],
      outroCta: { lang: "en", text: "Shop now on demandmesh.shop" },
      today: "2026-11-06",
      approvedCtas: { en: ["Shop now on demandmesh.shop"] },
      brandLines: { tagline: "Where demands connects.", groupBuyLine: "Buy it now, or buy together for less" },
    });
  it("fails free-text overlay claims not in the brief, e.g. '50% off'", () => {
    const items = run([{ kind: "claim", text: "50% off today only" }]);
    expect(items.find((i) => i.check === "product_claim_accuracy")?.status).toBe("fail");
  });
  it("fails edited prices and passes brief-derived ones", () => {
    expect(run([{ kind: "offer_price", text: "₹799" }]).some((i) => i.check === "offer_accuracy" && i.status === "fail")).toBe(true);
    expect(run([{ kind: "offer_price", text: "₹899" }, { kind: "offer_discount", text: "30% off" }]).every((i) => i.status !== "fail")).toBe(true);
  });
  it("accepts confirmed claims and the approved brand lines only", () => {
    expect(run([{ kind: "claim", text: "Keeps food apart", claimId: "clm_00000000000000000001" }, { kind: "tagline", text: "Where demands connects." }]).every((i) => i.status !== "fail")).toBe(true);
    expect(run([{ kind: "tagline", text: "Kerala's #1 shop" }]).find((i) => i.check === "product_claim_accuracy")?.status).toBe("fail");
  });
});
