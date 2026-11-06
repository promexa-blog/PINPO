import { describe, it, expect } from "vitest";
import { missingGlyphs, coverage, FONTS } from "@/server/render/fonts";

describe("font coverage (CR2)", () => {
  it("covers DemandMesh strings in EN, ML and HI", () => {
    expect(missingGlyphs("Buy together for less ₹1,299", "en")).toEqual([]);
    expect(missingGlyphs("ഒരുമിച്ച് വാങ്ങൂ, കുറഞ്ഞ വിലയിൽ ക്ഷ ന്റ ൾ", "ml")).toEqual([]);
    expect(missingGlyphs("साथ खरीदें, कम कीमत में क्षत्रज्ञ र्क", "hi")).toEqual([]);
  });
  it("reports characters no bundled font can draw", () => {
    expect(missingGlyphs("Great deal 😀", "en")).toEqual(["😀"]);
    expect(missingGlyphs("中文", "ml")).toEqual(["中", "文"]);
    expect(coverage(FONTS.latin).has(0x20b9)).toBe(true); // ₹
  });
});
