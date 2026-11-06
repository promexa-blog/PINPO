import { z } from "zod";
import { route, readJson } from "@/server/http";
import { db } from "@/server/db";
import { deleteAd, setCurrentVersion } from "@/server/db/repos/lifecycle";
import { AppError, now } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ adId: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { adId } = await ctx.params;
  const ad = db().prepare("SELECT id, name, current_version_id, created_at, updated_at FROM ads WHERE id = ? AND deleted_at IS NULL").get(adId);
  if (!ad) throw new AppError("NOT_FOUND", "Ad not found", 404);
  const versions = db().prepare("SELECT id, number, status, qa_status, created_at FROM ad_versions WHERE ad_id = ? ORDER BY number DESC").all(adId);
  return Response.json({ ad, versions });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { adId } = await ctx.params;
  const body = await readJson(req, z.object({ name: z.string().trim().min(1).max(120).optional(), currentVersionId: z.string().regex(/^ver_[a-f0-9]{20}$/).optional() }));
  if (body.name) db().prepare("UPDATE ads SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(body.name, now(), adId);
  if (body.currentVersionId) setCurrentVersion(adId, body.currentVersionId);
  return Response.json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const { adId } = await ctx.params;
  deleteAd(adId);
  return new Response(null, { status: 204 });
});
