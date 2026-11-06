import "../guard";
import { AppError } from "../util";
import { isAllowedHost } from "@/lib/hosts";

/**
 * Request guard for every API call. All methods: the Host must be the local studio (DNS-rebinding
 * guard). Mutations additionally (CSRF, plan §4): the browser's Origin must match that host, or
 * Sec-Fetch-Site must say same-origin. Requests from other sites fail.
 */
export function assertSameOrigin(req: Request): void {
  const host = req.headers.get("host");
  // DNS-rebinding guard on every method: a rebound page sends its own (foreign) Host.
  if (!isAllowedHost(host)) throw new AppError("BAD_HOST", "This studio only answers on 127.0.0.1 or localhost.", 421);
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
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
    if (!host || originHost !== host || !isAllowedHost(originHost)) throw new AppError("CROSS_ORIGIN", "Cross-origin request blocked", 403);
    return;
  }
  // No Origin: only allow when the fetch metadata says it's same-origin (e.g. same-origin GET-like tools).
  if (site !== "same-origin") throw new AppError("CROSS_ORIGIN", "Missing Origin header", 403);
}
