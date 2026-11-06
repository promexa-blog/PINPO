import { route } from "@/server/http";
import { storeUpload } from "@/server/storage/upload";
import { UploadMeta, UPLOAD_LIMITS } from "@/lib/schemas";
import { AppError } from "@/server/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = Math.max(UPLOAD_LIMITS.imageMaxBytes, UPLOAD_LIMITS.audioMaxBytes) + 64 * 1024;

/** POST multipart: `file` + `meta` (JSON: { purpose, provenance }) → stored asset (plan §8a, §9). */
export const POST = route(async (req: Request) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new AppError("FILE_TOO_LARGE", "Upload too large.", 413);
  const form = await req.formData().catch(() => {
    throw new AppError("BAD_FORM", "Expected multipart form data with `file` and `meta`.");
  });
  const file = form.get("file");
  const metaRaw = form.get("meta");
  if (!(file instanceof File)) throw new AppError("FILE_MISSING", "Choose a file to upload.", 400, "file");
  if (typeof metaRaw !== "string") throw new AppError("META_MISSING", "Upload details are missing.", 400, "meta");
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(metaRaw);
  } catch {
    throw new AppError("META_INVALID", "Upload details are not valid JSON.", 400, "meta");
  }
  const meta = UploadMeta.parse(metaJson);
  const asset = await storeUpload(Buffer.from(await file.arrayBuffer()), file.name, meta);
  return Response.json(
    { asset: { id: asset.id, kind: asset.kind, mime: asset.mime, width: asset.width, height: asset.height, durationS: asset.duration_s, bytes: asset.bytes } },
    { status: 201 },
  );
});
