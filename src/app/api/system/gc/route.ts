import { route } from "@/server/http";
import { enqueue } from "@/server/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Queue storage clean-up on the worker (plan §4: no work in the request). */
export const POST = route(async () => Response.json(enqueue({ type: "maintenance", idempotencyKey: `maintenance:gc:${Date.now()}`, input: { task: "gc" }, priority: 150 }), { status: 202 }));
