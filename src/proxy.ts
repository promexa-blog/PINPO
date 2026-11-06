import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost } from "@/lib/hosts";

/**
 * DNS-rebinding guard for every page and asset: refuse requests whose Host is not the local
 * studio (see src/lib/hosts.ts). API routes re-check this in route() as defence in depth.
 */
export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"))) {
    return new NextResponse("This studio only answers on 127.0.0.1 or localhost.", { status: 421, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's own hashed static files (harmless and hot).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
