import { z } from "zod";
import { route, readJson } from "@/server/http";
import { applyStoryboard } from "@/server/planning/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rule-based storyboard (plan §4). Returns the edited-scene list instead of overwriting unless confirm=true (S3). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  const { confirm } = await readJson(req, z.object({ confirm: z.boolean().default(false) }));
  const r = applyStoryboard(vid, confirm);
  return Response.json({ applied: r.applied, editedScenes: r.editedScenes, placeholders: r.storyboard.placeholders, warnings: r.storyboard.warnings, blocked: r.storyboard.blocked }, { status: r.applied ? 200 : 409 });
});
