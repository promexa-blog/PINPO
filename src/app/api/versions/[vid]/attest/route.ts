import { z } from "zod";
import { route, readJson } from "@/server/http";
import { attest } from "@/server/qa/reports";
import { requireVersion } from "@/server/db/repos/versions";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Final compliance attestation required by the export gate (plan §9 [v2.2]). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const { vid } = await ctx.params;
  const { confirm } = await readJson(req, z.object({ confirm: z.literal(true) }));
  if (!confirm || requireVersion(vid).status !== "ready") throw new AppError("NOT_READY", "Only a finished ad can be attested.", 409);
  attest(vid);
  return Response.json({ ok: true });
});
