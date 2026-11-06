import { z } from "zod";
import { route, readJson } from "@/server/http";
import { saveAsTemplate } from "@/server/planning/save-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  const { name } = await readJson(req, z.object({ name: z.string().trim().min(1).max(80) }));
  return Response.json(saveAsTemplate(vid, name), { status: 201 });
});
