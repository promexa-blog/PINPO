import "../guard";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { paths } from "../paths";

export type Lang = "en" | "ml" | "hi";

export interface FontFace {
  key: "latin" | "malayalam" | "devanagari";
  family: string;
  file: string;
  weights: [number, number];
  sha256: string;
}

/** Bundled placeholder fonts (OFL 1.1). Swap files + hashes here when DemandMesh's approved fonts arrive. */
export const FONTS: Record<FontFace["key"], FontFace> = {
  latin: {
    key: "latin",
    family: "PINPO Sans",
    file: "NotoSans.ttf",
    weights: [100, 900],
    sha256: "bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d",
  },
  malayalam: {
    key: "malayalam",
    family: "PINPO Malayalam",
    file: "NotoSansMalayalam.ttf",
    weights: [100, 900],
    sha256: "312e0e7c3cc15fa09eb42a8f749eeb246b593ed420e3c81aafe8d910c3a6fb56",
  },
  devanagari: {
    key: "devanagari",
    family: "PINPO Devanagari",
    file: "NotoSansDevanagari.ttf",
    weights: [100, 900],
    sha256: "14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e",
  },
};

/** Explicit per-language stacks — Phase 0 found Noto Sans also contains Devanagari, so order matters. */
export const LANG_STACK: Record<Lang, FontFace["key"][]> = {
  en: ["latin"],
  ml: ["malayalam", "latin"],
  hi: ["devanagari", "latin"],
};

export function fontFile(face: FontFace): string {
  return path.join(paths.bundled.fonts, face.file);
}

export function fontFaceCss(): string {
  return Object.values(FONTS)
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${pathToFileURL(fontFile(f)).href}") format("truetype");font-weight:${f.weights[0]} ${f.weights[1]};font-display:block}`,
    )
    .join("\n");
}

export function familyFor(lang: Lang): string {
  return LANG_STACK[lang].map((k) => `"${FONTS[k].family}"`).join(",");
}

// ---------- cmap coverage (plan §1 [v2.2]: catch "tofu" before rendering) ----------

const coverageCache = new Map<string, Set<number>>();

/** Parses the font's cmap (formats 4 and 12) into the set of covered code points. */
export function coverage(face: FontFace): Set<number> {
  const cached = coverageCache.get(face.key);
  if (cached) return cached;
  const buf = readFileSync(fontFile(face));
  const set = parseCmap(buf);
  coverageCache.set(face.key, set);
  return set;
}

export function parseCmap(buf: Buffer): Set<number> {
  const numTables = buf.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("latin1", rec, rec + 4) === "cmap") cmapOffset = buf.readUInt32BE(rec + 8);
  }
  if (cmapOffset < 0) throw new Error("Font has no cmap table");
  const n = buf.readUInt16BE(cmapOffset + 2);
  const subtables: { platform: number; encoding: number; offset: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rec = cmapOffset + 4 + i * 8;
    subtables.push({ platform: buf.readUInt16BE(rec), encoding: buf.readUInt16BE(rec + 2), offset: cmapOffset + buf.readUInt32BE(rec + 4) });
  }
  const pick =
    subtables.find((s) => s.platform === 3 && s.encoding === 10) ??
    subtables.find((s) => s.platform === 0 && buf.readUInt16BE(s.offset) === 12) ??
    subtables.find((s) => s.platform === 3 && s.encoding === 1) ??
    subtables.find((s) => s.platform === 0);
  if (!pick) throw new Error("No Unicode cmap subtable");
  const set = new Set<number>();
  const format = buf.readUInt16BE(pick.offset);
  if (format === 12) {
    const groups = buf.readUInt32BE(pick.offset + 12);
    for (let g = 0; g < groups; g++) {
      const o = pick.offset + 16 + g * 12;
      const start = buf.readUInt32BE(o);
      const end = buf.readUInt32BE(o + 4);
      const startGlyph = buf.readUInt32BE(o + 8);
      for (let c = start; c <= end; c++) if (startGlyph + (c - start) !== 0) set.add(c);
    }
  } else if (format === 4) {
    const segX2 = buf.readUInt16BE(pick.offset + 6);
    const ends = pick.offset + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const rangeOffsets = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = buf.readUInt16BE(ends + s * 2);
      const start = buf.readUInt16BE(starts + s * 2);
      const delta = buf.readInt16BE(deltas + s * 2);
      const ro = buf.readUInt16BE(rangeOffsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (ro === 0) glyph = (c + delta) & 0xffff;
        else {
          const gi = rangeOffsets + s * 2 + ro + (c - start) * 2;
          glyph = buf.readUInt16BE(gi);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) set.add(c);
      }
    }
  } else {
    throw new Error(`Unsupported cmap format ${format}`);
  }
  return set;
}

/** Characters that never need a glyph of their own (spaces, joiners, variation selectors). */
const IGNORABLE = /[\s​-‍⁠︀-️]/u;

/** Returns the characters in `text` that no font in the language's stack can draw. */
export function missingGlyphs(text: string, lang: Lang): string[] {
  const sets = LANG_STACK[lang].map((k) => coverage(FONTS[k]));
  const missing = new Set<string>();
  for (const ch of text) {
    if (IGNORABLE.test(ch)) continue;
    const cp = ch.codePointAt(0)!;
    if (!sets.some((s) => s.has(cp))) missing.add(ch);
  }
  return [...missing];
}
