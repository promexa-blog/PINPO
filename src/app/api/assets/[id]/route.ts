import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { route } from "@/server/http";
import { getAsset, absolutePath } from "@/server/storage/assets";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^ast_[a-f0-9]{20}$/;

/** Streams an asset by ID only (no paths in URLs), with HTTP Range for video seeking (plan §4, test A4/A6). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw new AppError("NOT_FOUND", "Asset not found", 404);
  const asset = getAsset(id);
  if (!asset) throw new AppError("NOT_FOUND", "Asset not found", 404);
  const file = absolutePath(asset);
  const { size } = await stat(file).catch(() => {
    throw new AppError("NOT_FOUND", "Asset file missing", 404);
  });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": asset.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${(asset.original_name ?? `${asset.id}`).replace(/[^\w.\-]+/g, "_")}"`,
  };
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m?.[1] ? Number(m[1]) : NaN;
    let end = m?.[2] ? Number(m[2]) : NaN;
    if (m && Number.isNaN(start) && !Number.isNaN(end)) {
      start = Math.max(0, size - end);
      end = size - 1;
    } else if (m && !Number.isNaN(start) && Number.isNaN(end)) end = size - 1;
    if (!m || Number.isNaN(start) || start > end || end >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
});
