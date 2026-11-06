import path from "node:path";
import { rm } from "node:fs/promises";
import { paths } from "@/server/paths";
import { renderer } from "@/server/render/browser";
import { familyFor } from "@/server/render/fonts";
import { newId } from "@/server/util";

/** One Malayalam + one Hindi string through the real renderer at worker start (plan §1 [v2.2]). */
export const SMOKE_STRINGS = { en: "DemandMesh ₹1,299", ml: "ഒരുമിച്ച് വാങ്ങൂ", hi: "साथ खरीदें" } as const;

export async function smokeTestRenderer(): Promise<string> {
  const out = path.join(paths.work, `smoke-${newId("s")}.png`);
  try {
    await renderer.render({
      width: 400,
      height: 200,
      outFile: out,
      css: `p{margin:8px;font-size:28px;font-weight:700;color:#0C1C28}.en{font-family:${familyFor("en")}}.ml{font-family:${familyFor("ml")}}.hi{font-family:${familyFor("hi")}}`,
      bodyHtml: `<p class="en" lang="en">DemandMesh ₹1,299</p><p class="ml" lang="ml">ഒരുമിച്ച് വാങ്ങൂ</p><p class="hi" lang="hi">साथ खरीदें</p>`,
      fonts: [
        { lang: "en", weight: 700, text: SMOKE_STRINGS.en },
        { lang: "ml", weight: 700, text: SMOKE_STRINGS.ml },
        { lang: "hi", weight: 700, text: SMOKE_STRINGS.hi },
      ],
    });
    return renderer.version ?? "unknown";
  } finally {
    await rm(out, { force: true });
  }
}
