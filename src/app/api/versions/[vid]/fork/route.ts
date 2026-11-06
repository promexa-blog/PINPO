import { route } from "@/server/http";
import { forkVersion } from "@/server/db/repos/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "New version from this" (plan §3). Returns the existing draft (409) if the ad already has one. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  const r = forkVersion(vid);
  return Response.json(r, { status: r.created ? 201 : 409 });
});
