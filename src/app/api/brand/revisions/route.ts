import { route } from "@/server/http";
import { getMasterBrand, brandRevisions } from "@/server/brand/master";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const b = getMasterBrand();
  return Response.json({ revisions: b ? brandRevisions(b.id) : [] });
});
