import { route, readJson } from "@/server/http";
import { patchDraft } from "@/server/db/repos/versions";
import { deleteVersion } from "@/server/db/repos/lifecycle";
import { versionView } from "@/server/views";
import { VersionPatch } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vid: string }> };

/** Read model with ETag so the 2s progress poll is cheap (plan §13). */
export const GET = route(async (req: Request, ctx: Ctx) => {
  const { vid } = await ctx.params;
  const { view, etag } = versionView(vid);
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return Response.json(view, { headers: { ETag: etag, "Cache-Control": "no-cache" } });
});

/** Draft autosave with optimistic revision (409 on conflict, 423 when locked). */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { vid } = await ctx.params;
  const patch = await readJson(req, VersionPatch, 1024 * 1024);
  const v = patchDraft(vid, patch);
  return Response.json({ revision: v.revision });
});

/** Delete a non-current, non-running version (plan §4). */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const { vid } = await ctx.params;
  deleteVersion(vid);
  return new Response(null, { status: 204 });
});
