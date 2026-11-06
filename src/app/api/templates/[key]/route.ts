import { route } from "@/server/http";
import { deleteUserTemplate } from "@/server/planning/save-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ key: string }> }) => {
  const { key } = await ctx.params;
  deleteUserTemplate(key);
  return new Response(null, { status: 204 });
});
