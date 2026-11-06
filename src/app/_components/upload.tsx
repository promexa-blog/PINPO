"use client";

import { useId, useRef, useState } from "react";
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

/** Upload with the rights questions plan §8a requires for each purpose. */
export function Upload({ purpose, label, onUploaded }: { purpose: Purpose; label: string; onUploaded: (asset: UploadedAsset) => void }) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState(purpose === "product_image" ? "own_photo" : purpose === "voiceover" ? "recorded_voice" : purpose === "brand_logo" ? "official_brand" : "stock_licensed");
  const [permission, setPermission] = useState(false);
  const [license, setLicense] = useState("");
  const [commercialUse, setCommercialUse] = useState<"yes" | "no" | "unknown">("unknown");
  const [attribution, setAttribution] = useState("");
  const [origin, setOrigin] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isImage = purpose === "product_image" || purpose === "brand_logo";

  const reset = () => {
    setFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const meta = {
      purpose,
      provenance: isImage
        ? { sourceType, commercialUse: permission ? "yes" : "unknown", permissionConfirmed: permission, origin: origin || null }
        : { sourceType, license: license || null, commercialUse, attributionText: attribution || null, origin: origin || null, ...(purpose === "voiceover" ? { talentConsent: consent } : {}) },
    };
    const form = new FormData();
    form.set("file", file);
    form.set("meta", JSON.stringify(meta));
    try {
      const res = await fetch("/api/assets", { method: "POST", body: form });
      const body = (await res.json()) as { asset?: UploadedAsset; error?: { message: string; fields?: { message: string }[] } };
      if (!res.ok || !body.asset) throw new Error([body.error?.message, ...(body.error?.fields?.map((f) => f.message) ?? [])].filter(Boolean).join(" "));
      onUploaded(body.asset);
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed border-line-strong bg-sunken/50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <input id={`${uid}-file`} ref={input} type="file" accept={ACCEPT[purpose]} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="peer sr-only" />
        <label htmlFor={`${uid}-file`} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel-2 px-3.5 text-sm font-semibold transition-colors hover:border-line-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
          <IconUpload size={16} />
          {file ? "Choose another file" : label}
        </label>
        {file ? (
          <span className="flex min-w-0 items-center gap-1 text-sm text-ink-2">
            <span className="truncate">{file.name}</span>
            <button type="button" aria-label="Clear the chosen file" onClick={reset} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-panel-2 hover:text-ink">
              <IconX size={14} />
            </button>
          </span>
        ) : (
          <span className="text-xs text-ink-3">{HINT[purpose]}</span>
        )}
      </div>
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
              <Checkbox id={`${uid}-perm`} checked={permission} onChange={setPermission} label="I have permission to use this image in my ads." />
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
          <div className="sm:col-span-2">
            <Button variant="secondary" onClick={upload} disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
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
