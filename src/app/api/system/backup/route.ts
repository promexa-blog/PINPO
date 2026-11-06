import { route } from "@/server/http";
import { enqueue } from "@/server/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => Response.json(enqueue({ type: "maintenance", idempotencyKey: `maintenance:backup:${Date.now()}`, input: { task: "backup" }, priority: 150 }), { status: 202 }));
