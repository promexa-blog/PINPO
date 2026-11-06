import { describe, it, expect } from "vitest";
import { sniff } from "@/server/security/sniff";
import { assertSameOrigin } from "@/server/security/origin";

const req = (method: string, headers: Record<string, string>) => new Request("http://127.0.0.1:3000/api/x", { method, headers });

describe("upload sniffing (A3)", () => {
  it("accepts real magic bytes only", () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.ext).toBe("jpg");
    expect(sniff(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"))?.ext).toBe("png");
    expect(sniff(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))?.ext).toBe("webp");
    expect(sniff(Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"))?.ext).toBe("wav");
    expect(sniff(Buffer.from("ID3\x04\0\0\0\0\0\0\0\0", "latin1"))?.ext).toBe("mp3");
    expect(sniff(Buffer.from("\0\0\0\x20ftypM4A \0\0\0\0", "latin1"))?.ext).toBe("m4a");
  });
  it("rejects SVG, HTML and executables even when renamed", () => {
    expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniff(Buffer.from("<!doctype html><html><body>hi</body></html>"))).toBeNull();
    expect(sniff(Buffer.from("7f454c46020101000000000000000000", "hex"))).toBeNull();
    expect(sniff(Buffer.from("MZ\x90\0\x03\0\0\0\x04\0\0\0", "latin1"))).toBeNull();
  });
});

describe("same-origin guard (A2)", () => {
  it("allows GET and same-origin mutations", () => {
    expect(() => assertSameOrigin(req("GET", {}))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" }))).not.toThrow();
  });
  it("blocks cross-origin and origin-less mutations", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example", host: "127.0.0.1:3000" }))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req("POST", { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req("DELETE", { host: "127.0.0.1:3000" }))).toThrow(/Missing Origin/);
  });
});
