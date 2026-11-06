import { route } from "@/server/http";
import { duplicateAd } from "@/server/db/repos/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ adId: string }> }) => {
  const { adId } = await ctx.params;
  return Response.json(duplicateAd(adId), { status: 201 });
});
