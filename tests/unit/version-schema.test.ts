import { describe, it, expect } from "vitest";
import { VersionPatch } from "@/lib/version";

describe("version patch schema", () => {
  it("accepts scenes whose overlays exist in only one language (zod 4 partial record regression)", () => {
    const scene = {
      role: "hook", label: "Hook", sceneType: "product_original", showsProduct: true, durationS: 3, visualDirection: "", prompt: "", motionPreset: "fade-up",
      creative: { camera: "static", lighting: "soft studio", setting: "desk", transitionOut: "cut", layoutVariant: "lower_third", productMotion: "push-in" },
      overlay: { layout: "lower_third", motion: "fade-up", byLang: { ml: [{ kind: "claim", text: "ഭക്ഷണം വേർതിരിച്ച് സൂക്ഷിക്കുന്നു", claimId: "clm_00000000000000000001" }] } },
      productAssetId: null,
    };
    expect(VersionPatch.safeParse({ revision: 3, scenes: [scene] }).success).toBe(true);
  });
  it("rejects unknown overlay kinds and out-of-range voiceover settings", () => {
    expect(VersionPatch.safeParse({ revision: 0, voiceovers: [{ assetId: "ast_00000000000000000000", scenePosition: 0, offsetS: -1, volumeDb: 0, fadeInS: 0, fadeOutS: 0 }] }).success).toBe(false);
  });
});
