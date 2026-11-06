import { route } from "@/server/http";
import { brandRevisions } from "@/server/brand/kits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => Response.json({ revisions: brandRevisions((await ctx.params).id) }));
