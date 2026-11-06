import { z } from "zod";
import { route, readJson } from "@/server/http";
import { getMasterBrand, updateBrandCopy, assertBrandDeletable } from "@/server/brand/master";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const b = getMasterBrand();
  if (!b) throw new AppError("BRAND_NOT_READY", "Brand not set up yet — start the worker once.", 409);
  return Response.json(b);
});

const Copy = z.object({
  tagline: z.string().trim().min(1).max(80).optional(),
  groupBuyLine: z.string().trim().min(1).max(80).optional(),
  approvedCtas: z.object({ en: z.array(z.string().trim().min(1).max(60)).max(10), ml: z.array(z.string().trim().min(1).max(80)).max(10), hi: z.array(z.string().trim().min(1).max(80)).max(10) }).optional(),
  social: z.record(z.string().max(20), z.string().max(60)).optional(),
  note: z.string().trim().max(200).optional(),
});

/** Edit brand copy — requires a recent unlock (423 otherwise); creates a revision (plan §3, B1/B2). */
export const PATCH = route(async (req: Request) => {
  const b = getMasterBrand();
  if (!b) throw new AppError("BRAND_NOT_READY", "Brand not set up yet.", 409);
  return Response.json(updateBrandCopy(b.id, await readJson(req, Copy)));
});

export const DELETE = route(async () => {
  const b = getMasterBrand();
  if (b) assertBrandDeletable(b.id);
  return new Response(null, { status: 204 });
});
