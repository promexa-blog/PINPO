import { route } from "@/server/http";
import { MODELS, publicModel, DEFAULT_MODEL } from "@/server/models/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json({ default: DEFAULT_MODEL, models: Object.values(MODELS).map(publicModel) }));
