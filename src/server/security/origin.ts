import "../guard";
import { AppError } from "../util";

/**
 * CSRF guard for mutating requests (plan §4): the browser's Origin must match the host the
 * request was sent to, or Sec-Fetch-Site must say same-origin. Requests from other sites fail.
 */
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (site && site !== "same-origin" && site !== "none") {
    throw new AppError("CROSS_ORIGIN", "Cross-origin request blocked", 403);
  }
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("CROSS_ORIGIN", "Invalid Origin header", 403);
    }
    if (!host || originHost !== host) throw new AppError("CROSS_ORIGIN", "Cross-origin request blocked", 403);
    return;
  }
  // No Origin: only allow when the fetch metadata says it's same-origin (e.g. same-origin GET-like tools).
  if (site !== "same-origin") throw new AppError("CROSS_ORIGIN", "Missing Origin header", 403);
}
