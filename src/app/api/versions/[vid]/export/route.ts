import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { route } from "@/server/http";
import { requireVersion } from "@/server/db/repos/versions";
import { exportGate } from "@/server/qa/reports";
import { getAsset, absolutePath } from "@/server/storage/assets";
import { db } from "@/server/db";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Export (plan §12): final MP4 only when the gate passes (no fails, reviews acknowledged, attested). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  const v = requireVersion(vid);
  if (v.status !== "ready" || !v.final_asset_id) throw new AppError("NOT_READY", "This ad isn't finished yet.", 409);
  const gate = exportGate(vid);
  if (!gate.ok) throw new AppError("EXPORT_BLOCKED", gate.reasons.join(" "), 409);
  db().prepare("UPDATE ad_versions SET qa_status = 'approved' WHERE id = ?").run(vid);
  const asset = getAsset(v.final_asset_id)!;
  const file = absolutePath(asset);
  const { size } = await stat(file);
  const name = (asset.original_name ?? `ad_v${v.number}.mp4`).replace(/[^\w.\-]+/g, "_");
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" },
  });
});
