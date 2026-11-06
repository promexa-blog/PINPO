import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "@/server/paths";
import { FONTS } from "@/server/render/fonts";
import { route } from "@/server/http";
import { AppError } from "@/server/util";

export const runtime = "nodejs";

const ALLOWED = new Set(Object.values(FONTS).map((f) => f.file));

/** Bundled brand fonts for the editor preview (allow-listed file names only). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ file: string }> }) => {
  const { file } = await ctx.params;
  if (!ALLOWED.has(file)) throw new AppError("NOT_FOUND", "Font not found", 404);
  const buf = await readFile(path.join(paths.bundled.fonts, file));
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});
