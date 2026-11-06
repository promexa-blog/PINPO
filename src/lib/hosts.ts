/**
 * Host allow-list (DNS-rebinding guard). The studio is a local app: browsers must reach it as
 * 127.0.0.1, localhost or [::1]. A page on another domain that re-points its DNS at 127.0.0.1
 * still sends its own name in the Host header, so any other host is refused — on every method,
 * including GET, because reads expose ads, brands and exports.
 *
 * Extra hostnames (e.g. a deliberate LAN name) can be allowed with
 * PINPO_ALLOWED_HOSTS="studio.local,192.168.1.20". Ports are not checked.
 *
 * Edge-safe: no Node or server imports (used by src/proxy.ts and the API route wrapper).
 */
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function extraHosts(): Set<string> {
  const raw = typeof process !== "undefined" ? process.env.PINPO_ALLOWED_HOSTS ?? "" : "";
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Hostname part of a Host header value ("127.0.0.1:3000" → "127.0.0.1", "[::1]:3000" → "[::1]"). */
export function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const i = h.lastIndexOf(":");
  return i > -1 && h.indexOf(":") === i ? h.slice(0, i) : h;
}

export function isAllowedHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const name = hostname(hostHeader);
  return LOCAL.has(name) || extraHosts().has(name);
}
