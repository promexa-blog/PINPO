import { route } from "@/server/http";
import { acknowledge } from "@/server/qa/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ vid: string; itemId: string }> }) => {
  const { vid, itemId } = await ctx.params;
  acknowledge(vid, itemId);
  return Response.json({ ok: true });
});
