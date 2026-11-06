import { route } from "@/server/http";
import { db } from "@/server/db";
import { requireVersion } from "@/server/db/repos/versions";
import { usedAssets } from "@/server/qa/used-assets";
import { creditsText } from "@/server/qa/checks/rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** credits.txt for the export (plan §8a, test PV4). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  const v = requireVersion(vid);
  const ad = db().prepare("SELECT name FROM ads WHERE id = ?").get(v.ad_id) as { name: string };
  const text = creditsText(usedAssets(vid), `${ad.name} (v${v.number})`);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...(download ? { "Content-Disposition": 'attachment; filename="credits.txt"' } : {}) } });
});
