import { z } from "zod";
import { route, readJson } from "@/server/http";
import { addCost } from "@/server/jobs/costs";
import { requireVersion } from "@/server/db/repos/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manually confirmed amount from the fal dashboard (plan §10, test C2). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  requireVersion(vid);
  const { usd, note } = await readJson(req, z.object({ usd: z.number().min(0).max(10_000), note: z.string().trim().min(3).max(300) }));
  addCost({ kind: "confirmed_manual", usd, versionId: vid, note });
  return Response.json({ ok: true }, { status: 201 });
});
