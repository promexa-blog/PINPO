import { route, readJson } from "@/server/http";
import { getBrand, updateBrand, deleteBrand } from "@/server/brand/kits";
import { BrandPatch } from "@/lib/brand";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const b = getBrand((await ctx.params).id);
  if (!b) throw new AppError("NOT_FOUND", "Brand not found", 404);
  return Response.json(b);
});

/** Edit — requires a recent unlock (423 otherwise); saves a new revision (plan §3, B1/B2). */
export const PATCH = route(async (req: Request, ctx: Ctx) => Response.json(updateBrand((await ctx.params).id, await readJson(req, BrandPatch))));

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  deleteBrand((await ctx.params).id);
  return new Response(null, { status: 204 });
});
