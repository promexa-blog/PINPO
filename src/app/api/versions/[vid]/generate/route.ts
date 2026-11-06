import { route } from "@/server/http";
import { startGenerate, DraftNotReady } from "@/server/jobs/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  try {
    return Response.json(await startGenerate(vid), { status: 202 });
  } catch (err) {
    if (err instanceof DraftNotReady) return Response.json({ error: { code: err.code, message: "This draft isn't ready to generate.", items: err.items } }, { status: 422 });
    throw err;
  }
});
