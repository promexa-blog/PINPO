import { z } from "zod";
import { route, readJson } from "@/server/http";
import { createAd, listAds } from "@/server/db/repos/versions";
import { seedTemplates } from "@/server/planning/templates";
import { PlatformKeySchema } from "@/lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q")?.toLowerCase().trim();
  const status = new URL(req.url).searchParams.get("status");
  let ads = listAds();
  if (q) ads = ads.filter((a) => a.name.toLowerCase().includes(q));
  if (status) ads = ads.filter((a) => a.status === status);
  return Response.json({ ads: ads.map((a) => ({ ...a, lengthS: (JSON.parse(a.settings_json) as { lengthS: number }).lengthS, settings_json: undefined })) });
});

const CreateAd = z.object({ name: z.string().trim().min(1).max(120), templateKey: z.string().regex(/^[a-z_]+$/), platform: PlatformKeySchema });

export const POST = route(async (req: Request) => {
  seedTemplates();
  const body = await readJson(req, CreateAd);
  return Response.json(createAd(body), { status: 201 });
});
