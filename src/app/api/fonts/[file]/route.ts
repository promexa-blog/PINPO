import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "@/server/paths";
import { route } from "@/server/http";
import { AppError } from "@/server/util";

export const runtime = "nodejs";

/**
 * Web fonts for the studio UI and the WYSIWYG previews: woff2 subsets of the renderer's TTFs
 * (assets/fonts/web). Allow-listed file names only. The video renderer reads the TTFs directly.
 */
const ALLOWED = new Set(["NotoSans-Latin.woff2", "NotoSans-Rupee.woff2", "NotoSans-Separators.woff2", "NotoSansMalayalam.woff2", "NotoSansDevanagari.woff2"]);

export const GET = route(async (_req: Request, ctx: { params: Promise<{ file: string }> }) => {
  const { file } = await ctx.params;
  if (!ALLOWED.has(file)) throw new AppError("NOT_FOUND", "Font not found", 404);
  const buf = await readFile(path.join(paths.bundled.fonts, "web", file));
  // Files change only with a release; revalidate daily rather than "immutable" on a stable URL.
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
});
