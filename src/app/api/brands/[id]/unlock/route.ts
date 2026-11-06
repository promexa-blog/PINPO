import { route } from "@/server/http";
import { unlockBrand } from "@/server/brand/kits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => Response.json(unlockBrand((await ctx.params).id)));
