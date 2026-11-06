"use client";

import { useId, useState } from "react";
import { Button, Checkbox, Field, Input, Select } from "./ui";

type Purpose = "product_image" | "music" | "voiceover";

/** Upload with the rights questions plan §8a requires for each purpose. */
export function Upload({ purpose, label, onUploaded }: { purpose: Purpose; label: string; onUploaded: (asset: { id: string; width: number | null; height: number | null; durationS: number | null }) => void }) {
  const uid = useId();
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState(purpose === "product_image" ? "own_photo" : purpose === "voiceover" ? "recorded_voice" : "stock_licensed");
  const [permission, setPermission] = useState(false);
  const [license, setLicense] = useState("");
  const [commercialUse, setCommercialUse] = useState<"yes" | "no" | "unknown">("unknown");
  const [attribution, setAttribution] = useState("");
  const [origin, setOrigin] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const meta = {
      purpose,
      provenance:
        purpose === "product_image"
          ? { sourceType, commercialUse: permission ? "yes" : "unknown", permissionConfirmed: permission, origin: origin || null }
          : { sourceType, license: license || null, commercialUse, attributionText: attribution || null, origin: origin || null, ...(purpose === "voiceover" ? { talentConsent: consent } : {}) },
    };
    const form = new FormData();
    form.set("file", file);
    form.set("meta", JSON.stringify(meta));
    try {
      const res = await fetch("/api/assets", { method: "POST", body: form });
      const body = (await res.json()) as { asset?: { id: string; width: number | null; height: number | null; durationS: number | null }; error?: { message: string; fields?: { message: string }[] } };
      if (!res.ok || !body.asset) throw new Error([body.error?.message, ...(body.error?.fields?.map((f) => f.message) ?? [])].filter(Boolean).join(" "));
      onUploaded(body.asset);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed border-dm-border p-3">
      <Field label={label} htmlFor={`${uid}-file`} hint={purpose === "product_image" ? "JPG, PNG or WebP, at least 300×300 px, up to 10 MB. Transparent PNG cut-outs look best." : "MP3, WAV or M4A, up to 20 MB."}>
        <input
          id={`${uid}-file`}
          type="file"
          accept={purpose === "product_image" ? "image/jpeg,image/png,image/webp" : "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-dm-border file:bg-dm-surface file:px-3 file:text-sm file:font-semibold"
        />
      </Field>
      {file ? (
        <div className="grid gap-3 sm:grid-cols-2">
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
          <Field label="Source (optional)" htmlFor={`${uid}-origin`} hint="Supplier name, stock site + item ID, or link.">
            <Input id={`${uid}-origin`} value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={500} />
          </Field>
          {purpose === "product_image" ? (
            <div className="sm:col-span-2">
              <Checkbox id={`${uid}-perm`} checked={permission} onChange={setPermission} label="I have permission to use this image in DemandMesh ads." />
            </div>
          ) : (
            <>
              <Field label="Licence" htmlFor={`${uid}-lic`} hint="e.g. Royalty-free (stock), Owned by DemandMesh, CC BY 4.0">
                <Input id={`${uid}-lic`} value={license} onChange={(e) => setLicense(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Commercial use allowed?" htmlFor={`${uid}-cu`}>
                <Select id={`${uid}-cu`} value={commercialUse} onChange={(e) => setCommercialUse(e.target.value as "yes" | "no" | "unknown")}>
                  <option value="unknown">Not sure</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="Credit line (if the licence needs one)" htmlFor={`${uid}-att`}>
                <Input id={`${uid}-att`} value={attribution} onChange={(e) => setAttribution(e.target.value)} maxLength={300} />
              </Field>
              {purpose === "voiceover" ? <Checkbox id={`${uid}-consent`} checked={consent} onChange={setConsent} label="The voice artist agreed to commercial ad use." /> : null}
            </>
          )}
          <div className="sm:col-span-2">
            <Button type="button" variant="secondary" onClick={upload} disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}
