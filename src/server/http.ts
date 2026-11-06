import "./guard";
import { z } from "zod";
import { AppError } from "./util";
import { assertSameOrigin } from "./security/origin";

export interface ErrorBody {
  error: { code: string; message: string; field?: string; fields?: { path: string; message: string }[] };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } } satisfies ErrorBody, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are missing or invalid.",
          fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      } satisfies ErrorBody,
      { status: 400 },
    );
  }
  console.error("Unhandled API error", err);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong on the server." } } satisfies ErrorBody, { status: 500 });
}

/** Wraps a route handler: same-origin check for mutations + uniform JSON errors. */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 512 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Request body too large", 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Request body too large", 413);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError("BAD_JSON", "Body must be JSON", 400);
  }
  return schema.parse(data);
}
