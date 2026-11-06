import { describe, it, expect } from "vitest";
import { seedTemplates, getTemplate } from "@/server/planning/templates";
import { db } from "@/server/db";

describe("built-in templates", () => {
  it("seed idempotently and load by key", () => {
    seedTemplates();
    seedTemplates();
    const n = (db().prepare("SELECT COUNT(*) AS n FROM templates WHERE builtin = 1").get() as { n: number }).n;
    expect(n).toBeGreaterThanOrEqual(1);
    const t = getTemplate("product_showcase")!;
    expect(t.name).toBe("Product showcase");
    expect(t.scenes.map((s) => s.role)).toEqual(["hook", "hero_detail", "use_moment", "benefit", "lifestyle", "cta"]);
    for (const s of t.scenes) expect(s.overlay.layout).toBeTruthy();
  });
});
