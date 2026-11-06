import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { renderer } from "@/server/render/browser";
import { familyFor } from "@/server/render/fonts";
import { paths } from "@/server/paths";

mkdirSync(paths.work, { recursive: true });
const out = (n: string) => path.join(paths.work, `${n}.png`);
const css = `p{margin:10px;font-size:32px;font-weight:700;color:#0C1C28;font-family:${familyFor("en")}}`;

afterAll(async () => renderer.close());

describe("brand renderer (Chrome)", () => {
  it("renders deterministic, exact-size PNGs (CR6)", async () => {
    const req = { width: 540, height: 200, css, bodyHtml: "<p>Shop now on demandmesh.shop</p>", fonts: [{ lang: "en" as const, weight: 700, text: "Shop now on demandmesh.shop" }] };
    await renderer.render({ ...req, outFile: out("a") });
    await renderer.render({ ...req, outFile: out("b") });
    expect(readFileSync(out("a")).equals(readFileSync(out("b")))).toBe(true);
    const m = await sharp(out("a")).metadata();
    expect([m.width, m.height]).toEqual([540, 200]);
  });

  it("renders user text as literal text — no HTML/script injection (CR3)", async () => {
    const evil = `<img src=x onerror="document.body.style.background='red'"><script>document.body.style.background='red'</script>`;
    const bodyHtml = renderToStaticMarkup(createElement("p", null, evil));
    expect(bodyHtml).not.toContain("<img");
    await renderer.render({ width: 400, height: 120, css, bodyHtml, fonts: [{ lang: "en", weight: 700, text: evil }], outFile: out("inj") });
    const { data } = await sharp(out("inj")).extract({ left: 395, top: 115, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]); // background untouched
  });

  it("blocks remote resources (CR4)", async () => {
    await expect(
      renderer.render({ width: 200, height: 100, css, bodyHtml: `<img src="https://example.com/x.png" alt="">`, fonts: [], outFile: out("net") }),
    ).rejects.toMatchObject({ code: "RENDER_NETWORK_BLOCKED" });
  });

  it("refuses text the fonts can't draw instead of rendering tofu (CR2)", async () => {
    await expect(
      renderer.render({ width: 200, height: 100, css, bodyHtml: "<p>😀</p>", fonts: [{ lang: "en", weight: 700, text: "😀" }], outFile: out("tofu") }),
    ).rejects.toMatchObject({ code: "GLYPH_MISSING" });
  });

  it("recovers when Chrome is killed (CR5)", async () => {
    const req = { width: 300, height: 100, css, bodyHtml: "<p>DemandMesh</p>", fonts: [{ lang: "en" as const, weight: 700, text: "DemandMesh" }] };
    await renderer.render({ ...req, outFile: out("pre") });
    const pid = renderer.pid!;
    process.kill(pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
    await renderer.render({ ...req, outFile: out("post") });
    expect(renderer.pid).not.toBe(pid);
    expect(() => process.kill(pid, 0)).toThrow(); // old process gone
  });

  it("shapes Malayalam and Hindi with the bundled fonts (L1 smoke)", async () => {
    const ml = "ഒരുമിച്ച് വാങ്ങൂ";
    const hi = "साथ खरीदें";
    await renderer.render({
      width: 500,
      height: 160,
      css: `p{margin:8px;font-size:40px;font-weight:700}.ml{font-family:${familyFor("ml")}}.hi{font-family:${familyFor("hi")}}`,
      bodyHtml: `<p class="ml" lang="ml">${ml}</p><p class="hi" lang="hi">${hi}</p>`,
      fonts: [{ lang: "ml", weight: 700, text: ml }, { lang: "hi", weight: 700, text: hi }],
      outFile: out("indic"),
    });
    const stats = await sharp(out("indic")).stats();
    expect(stats.channels[0]!.min).toBeLessThan(60); // dark glyph pixels were drawn
  });
});
