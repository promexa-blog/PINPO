import { route, readJson } from "@/server/http";
import { createBrand, listBrands } from "@/server/brand/kits";
import { BrandCreate } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json({ brands: listBrands() }));

/** Create a brand kit (revision 1, locked). */
export const POST = route(async (req: Request) => {
  const brand = createBrand(await readJson(req, BrandCreate));
  return Response.json(brand, { status: 201 });
});
