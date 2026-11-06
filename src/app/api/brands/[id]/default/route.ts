import { route } from "@/server/http";
import { setDefaultBrand } from "@/server/brand/kits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Make this brand the default for new ads. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  setDefaultBrand((await ctx.params).id);
  return new Response(null, { status: 204 });
});
