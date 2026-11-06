import { route } from "@/server/http";
import { getMasterBrand, unlockBrand } from "@/server/brand/master";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  const b = getMasterBrand();
  if (!b) throw new AppError("BRAND_NOT_READY", "Brand not set up yet.", 409);
  return Response.json(unlockBrand(b.id));
});
