import "../guard";

export type SniffedType =
  | { kind: "image"; mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" }
  | { kind: "audio"; mime: "audio/mpeg" | "audio/wav" | "audio/mp4"; ext: "mp3" | "wav" | "m4a" }
  | { kind: "video"; mime: "video/mp4"; ext: "mp4" };

const ascii = (buf: Buffer, start: number, len: number) => buf.subarray(start, start + len).toString("latin1");

/**
 * Identifies uploads by magic bytes only (never by name or client MIME). SVG/HTML/anything
 * else is rejected — plan §9 [v2.2].
 */
export function sniff(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png", ext: "png" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WAVE") return { kind: "audio", mime: "audio/wav", ext: "wav" };
  if (ascii(buf, 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && (buf[1]! & 0x06) !== 0)) {
    return { kind: "audio", mime: "audio/mpeg", ext: "mp3" };
  }
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4);
    if (brand === "M4A " || brand === "M4B ") return { kind: "audio", mime: "audio/mp4", ext: "m4a" };
    if (["isom", "iso2", "mp41", "mp42", "avc1", "dash", "M4V "].includes(brand)) return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  return null;
}
