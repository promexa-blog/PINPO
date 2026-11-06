import { route } from "@/server/http";
import { systemStatus } from "@/server/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await systemStatus(), { headers: { "Cache-Control": "no-store" } }));
