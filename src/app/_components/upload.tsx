"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Select } from "./ui";
import { IconUpload, IconX } from "./icons";

type Purpose = "product_image" | "music" | "voiceover" | "brand_logo";
export interface UploadedAsset {
  id: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
}

const ACCEPT: Record<Purpose, string> = {
  product_image: "image/jpeg,image/png,image/webp",
  brand_logo: "image/png,image/jpeg,image/webp",
  music: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a",
  voiceover: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a",
};
const HINT: Record<Purpose, string> = {
  product_image: "JPG, PNG or WebP · at least 300×300 px · up to 10 MB. Transparent PNG cut-outs look best.",
  brand_logo: "PNG with a transparent background works best · at least 160 px wide. Shown no larger than 1.25× its size.",
  music: "MP3, WAV or M4A · up to 20 MB.",
  voiceover: "MP3, WAV or M4A · up to 20 MB.",
};

/**
 * Upload with the rights questions plan §8a requires for each purpose. With `multiple`, several
 * files (picked or dropped) share one set of answers, upload in turn, and arrive in one callback.
 */
export function Upload({
  purpose,
  label,
  onUploaded,
  multiple,
  onUploadedMany,
}: {
  purpose: Purpose;
  label: string;
  onUploaded?: (asset: UploadedAsset) => void;
  /** Max files per batch (enables multi-select and multi-drop). */
  multiple?: number;
  onUploadedMany?: (assets: UploadedAsset[]) => void;
}) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceType, setSourceType] = useState(purpose === "product_image" ? "own_photo" : purpose === "voiceover" ? "recorded_voice" : purpose === "brand_logo" ? "official_brand" : "stock_licensed");
  const [permission, setPermission] = useState(false);
  const [license, setLicense] = useState("");
  const [commercialUse, setCommercialUse] = useState<"yes" | "no" | "unknown">("unknown");
  const [attribution, setAttribution] = useState("");
  const [origin, setOrigin] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isImage = purpose === "product_image" || purpose === "brand_logo";
  const max = multiple ?? 1;
  const busy = progress !== null;
  const file = files[0] ?? null;
  const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

  // Thumbnails for chosen images (object URLs are released when the selection changes).
  const previews = useMemo(() => (isImage ? files.map((f) => URL.createObjectURL(f)) : []), [files, isImage]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const choose = (list: FileList | File[] | null) => {
    const kind = isImage ? "image/" : "audio/";
    const picked = [...(list ?? [])].filter((f) => f.type.startsWith(kind) || f.type === "");
    setError(picked.length < (list?.length ?? 0) ? `Some files were skipped — this slot takes ${isImage ? "images" : "audio"} only.` : null);
    setFailed({});
    if (picked.length > max) {
      setError(`You can add ${max} more ${max === 1 ? "file" : "files"} here — the first ${max} were kept.`);
    }
    setFiles(picked.slice(0, max));
    if (input.current) input.current.value = "";
  };

  const reset = () => {
    setFiles([]);
    setFailed({});
    setError(null);
    if (input.current) input.current.value = "";
  };

  async function upload() {
    if (!files.length) return;
    setError(null);
    const meta = {
      purpose,
      provenance: isImage
        ? { sourceType, commercialUse: permission ? "yes" : "unknown", permissionConfirmed: permission, origin: origin || null }
        : { sourceType, license: license || null, commercialUse, attributionText: attribution || null, origin: origin || null, ...(purpose === "voiceover" ? { talentConsent: consent } : {}) },
    };
    const ok: UploadedAsset[] = [];
    const bad: Record<string, string> = {};
    const remaining: File[] = [];
    setProgress({ done: 0, total: files.length });
    for (const [i, f] of files.entries()) {
      const form = new FormData();
      form.set("file", f);
      form.set("meta", JSON.stringify(meta));
      try {
        const res = await fetch("/api/assets", { method: "POST", body: form });
        const body = (await res.json()) as { asset?: UploadedAsset; error?: { message: string; fields?: { message: string }[] } };
        if (!res.ok || !body.asset) throw new Error([body.error?.message, ...(body.error?.fields?.map((x) => x.message) ?? [])].filter(Boolean).join(" "));
        ok.push(body.asset);
      } catch (e) {
        bad[key(f)] = (e as Error).message;
        remaining.push(f);
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    if (ok.length) {
      if (onUploadedMany) onUploadedMany(ok);
      else ok.forEach((a) => onUploaded?.(a));
    }
    setFiles(remaining);
    setFailed(bad);
    if (input.current) input.current.value = "";
    if (remaining.length) setError(remaining.length === files.length ? "Nothing was uploaded — see the reasons below." : `${ok.length} uploaded, ${remaining.length} didn't — see the reasons below.`);
  }

  return (
    <div
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) choose(e.dataTransfer.files);
      }}
      className={`grid gap-3 rounded-lg border border-dashed p-3 transition-colors duration-150 ${dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-sunken/50"}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input id={`${uid}-file`} ref={input} type="file" accept={ACCEPT[purpose]} multiple={max > 1} disabled={busy} onChange={(e) => choose(e.target.files)} className="peer sr-only" />
        <label htmlFor={`${uid}-file`} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel-2 px-3.5 text-sm font-semibold transition-colors hover:border-line-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
          <IconUpload size={16} />
          {files.length ? (max > 1 ? "Choose different files" : "Choose another file") : label}
        </label>
        {files.length ? (
          <span className="flex min-w-0 items-center gap-1 text-sm text-ink-2">
            <span className="truncate">{files.length === 1 ? file!.name : `${files.length} files selected`}</span>
            <button type="button" aria-label={files.length === 1 ? "Clear the chosen file" : "Clear the chosen files"} onClick={reset} disabled={busy} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-panel-2 hover:text-ink">
              <IconX size={14} />
            </button>
          </span>
        ) : (
          <span className="text-xs text-ink-3">
            {max > 1 ? `Select or drop up to ${max} at once. ` : "Or drop a file here. "}
            {HINT[purpose]}
          </span>
        )}
      </div>
      {files.length > 1 || (files.length === 1 && isImage) ? (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen files">
          {files.map((f, i) => (
            <li key={key(f)} className={`relative flex items-center gap-2 rounded-lg border bg-panel py-1 pl-1 pr-8 text-xs ${failed[key(f)] ? "border-bad/50" : "border-line"}`}>
              {isImage && previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[i]} alt="" className="size-10 rounded-md bg-white object-contain" />
              ) : null}
              <span className="grid max-w-[11rem] gap-0.5">
                <span className="truncate font-medium">{f.name}</span>
                <span className={`truncate ${failed[key(f)] ? "font-semibold text-bad" : "text-ink-3"}`}>{failed[key(f)] ?? `${(f.size / 1024 ** 2).toFixed(1)} MB`}</span>
              </span>
              <button type="button" aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => setFiles((x) => x.filter((y) => y !== f))} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-panel-2 hover:text-ink">
                <IconX size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {file ? (
        <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          {purpose === "brand_logo" ? (
            <div className="sm:col-span-2">
              <Checkbox id={`${uid}-perm`} checked={permission} onChange={setPermission} label="This is the brand's official logo and I may use it in ads." />
            </div>
          ) : (
            <>
              <Field label="Where is it from?" htmlFor={`${uid}-src`}>
                <Select id={`${uid}-src`} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                  {purpose === "product_image" ? (
                    <>
                      <option value="own_photo">Our own photo</option>
                      <option value="product_supplier">From the product supplier</option>
                    </>
                  ) : (
                    <>
                      <option value="stock_licensed">Licensed stock</option>
                      <option value="commissioned">Commissioned for us</option>
                      {purpose === "voiceover" ? <option value="recorded_voice">We recorded it</option> : <option value="own_photo">We made it</option>}
                    </>
                  )}
                </Select>
              </Field>
              <Field label="Source" htmlFor={`${uid}-origin`} optional hint="Supplier name, stock site and item ID, or a link.">
                <Input id={`${uid}-origin`} value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={500} />
              </Field>
            </>
          )}
          {purpose === "product_image" ? (
            <div className="sm:col-span-2">
              <Checkbox id={`${uid}-perm`} checked={permission} onChange={setPermission} label={files.length > 1 ? "I have permission to use these images in my ads." : "I have permission to use this image in my ads."} />
            </div>
          ) : purpose !== "brand_logo" ? (
            <>
              <Field label="Licence" htmlFor={`${uid}-lic`} hint="e.g. Royalty-free (stock), Our own recording, CC BY 4.0">
                <Input id={`${uid}-lic`} value={license} onChange={(e) => setLicense(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Commercial use allowed?" htmlFor={`${uid}-cu`}>
                <Select id={`${uid}-cu`} value={commercialUse} onChange={(e) => setCommercialUse(e.target.value as "yes" | "no" | "unknown")}>
                  <option value="unknown">Not sure</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="Credit line" htmlFor={`${uid}-att`} optional hint="Needed if the licence asks for credit.">
                <Input id={`${uid}-att`} value={attribution} onChange={(e) => setAttribution(e.target.value)} maxLength={300} />
              </Field>
              {purpose === "voiceover" ? (
                <div className="self-end">
                  <Checkbox id={`${uid}-consent`} checked={consent} onChange={setConsent} label="The voice artist agreed to commercial ad use." />
                </div>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button variant="secondary" onClick={upload} disabled={busy}>
              {progress ? (progress.total > 1 ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Uploading…") : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
            </Button>
            {progress && progress.total > 1 ? (
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
