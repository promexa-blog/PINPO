import { route } from "@/server/http";
import { cancelVersion } from "@/server/jobs/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  return Response.json({ canceledJobs: cancelVersion(vid) }, { status: 202 });
});
