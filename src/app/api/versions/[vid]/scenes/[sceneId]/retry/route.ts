import { route } from "@/server/http";
import { retryScene } from "@/server/jobs/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ vid: string; sceneId: string }> }) => {
  const { vid, sceneId } = await ctx.params;
  retryScene(vid, sceneId);
  return Response.json({ ok: true }, { status: 202 });
});
