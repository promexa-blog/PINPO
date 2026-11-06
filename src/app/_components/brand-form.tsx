"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BRAND_CONTRAST, HEX, contrastRatio, darkenToContrast, derivePalette } from "@/lib/color";
import { BrandPreview } from "./brand-preview";
import { Upload } from "./upload";
import { Button, Field, Input, Notice, Section, Textarea, api } from "./ui";
import { IconCheck, IconLock, IconTrash } from "./icons";

export interface BrandFormValues {
  name: string;
  website: string;
  tagline: string;
  primary: string;
  secondary: string;
  logo: { assetId: string; width: number; height: number } | null;
  ctas: { en: string; ml: string; hi: string };
  groupBuyLine: string;
  instagram: string;
}

export const EMPTY_BRAND: BrandFormValues = { name: "", website: "", tagline: "", primary: "#1F2A37", secondary: "#5B6B7A", logo: null, ctas: { en: "", ml: "", hi: "" }, groupBuyLine: "", instagram: "" };

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Create or edit a brand kit with a live preview of its real outro and overlay. */
export function BrandForm({ mode, initial, brandId, next }: { mode: "create" | "edit"; initial: BrandFormValues; brandId?: string; next?: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [editing, setEditing] = useState(mode === "create");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<BrandFormValues>) => {
    setSaved(false);
    setV((x) => ({ ...x, ...patch }));
  };
  const validHex = HEX.test(v.primary) && HEX.test(v.secondary);
  const palette = validHex ? derivePalette(v.primary, v.secondary) : derivePalette(EMPTY_BRAND.primary, EMPTY_BRAND.secondary);
  const cp = HEX.test(v.primary) ? contrastRatio(v.primary, "#FFFFFF") : 0;
  const cs = HEX.test(v.secondary) ? contrastRatio(v.secondary, "#FFFFFF") : 0;
  const disabled = !editing || busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: v.name,
      website: v.website,
      tagline: v.tagline,
      primary: v.primary.toUpperCase(),
      secondary: v.secondary.toUpperCase(),
      logoAssetId: v.logo?.assetId ?? null,
      approvedCtas: { en: lines(v.ctas.en), ml: lines(v.ctas.ml), hi: lines(v.ctas.hi) },
      groupBuyLine: v.groupBuyLine,
      social: v.instagram.trim() ? { instagram: v.instagram.trim() } : {},
    };
    try {
      if (mode === "create") {
        const b = await api<{ id: string }>("/api/brands", { method: "POST", body: JSON.stringify(body) });
        router.push(next === "new" ? `/new?brand=${b.id}` : `/brands/${b.id}`);
        router.refresh();
        return;
      }
      await api(`/api/brands/${brandId}`, { method: "PATCH", body: JSON.stringify({ ...body, note: note || undefined }) });
      setEditing(false);
      setSaved(true);
      setNote("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setError(null);
    try {
      await api(`/api/brands/${brandId}/unlock`, { method: "POST" });
      setEditing(true);
      setSaved(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const colorRow = (key: "primary" | "secondary", labelText: string, hint: string, ratio: number, need: number) => (
    <Field label={labelText} htmlFor={`b-${key}`} hint={hint}>
      <div className="flex gap-2">
        <input type="color" aria-label={`${labelText} picker`} value={HEX.test(v[key]) ? v[key] : "#000000"} disabled={disabled} onChange={(e) => set({ [key]: e.target.value.toUpperCase() } as Partial<BrandFormValues>)} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-sunken p-1 disabled:cursor-not-allowed" />
        <Input id={`b-${key}`} value={v[key]} maxLength={7} disabled={disabled} className="tabular uppercase" onChange={(e) => set({ [key]: e.target.value } as Partial<BrandFormValues>)} />
      </div>
      {HEX.test(v[key]) ? (
        ratio >= need ? (
          <p className="flex items-center gap-1.5 text-xs text-ok">
            <IconCheck size={13} /> <span className="tabular">{ratio.toFixed(1)}:1</span> on white — readable
          </p>
        ) : (
          <p className="text-xs font-semibold text-warn">
            <span className="tabular">{ratio.toFixed(1)}:1</span> on white, needs {need}:1.{" "}
            {editing ? (
              <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set({ [key]: darkenToContrast(v[key], need) } as Partial<BrandFormValues>)}>
                Use {darkenToContrast(v[key], need)}
              </button>
            ) : null}
          </p>
        )
      ) : (
        <p className="text-xs font-semibold text-bad">Use a hex colour like #1F2A37.</p>
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 content-start gap-5">
        {mode === "edit" && !editing ? (
          <Notice>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2">
                <IconLock size={16} className="shrink-0 text-ink-2" />
                {saved ? "Saved as a new revision. Brand settings are locked again." : "Locked so ads stay consistent. Changes save as a new revision; ads already made keep theirs."}
              </p>
              <Button variant="secondary" onClick={unlock}>
                Unlock to edit
              </Button>
            </div>
          </Notice>
        ) : null}

        <Section title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name" htmlFor="b-name">
              <Input id="b-name" value={v.name} maxLength={60} required disabled={disabled} placeholder="e.g. Kappa Coffee" onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Website" htmlFor="b-web" hint="Shown on every ending, exactly as written here.">
              <Input id="b-web" value={v.website} maxLength={120} required disabled={disabled} placeholder="yourshop.com" inputMode="url" onChange={(e) => set({ website: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tagline" htmlFor="b-tag" optional>
                <Input id="b-tag" value={v.tagline} maxLength={80} disabled={disabled} placeholder="e.g. Slow roasted, every week." onChange={(e) => set({ tagline: e.target.value })} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Colours" description="Two colours are enough — lighter tints for panels and backgrounds are worked out for you. They only appear inside your ads.">
          <div className="grid gap-4 sm:grid-cols-2">
            {colorRow("primary", "Main colour", "Buttons, text panels and your website on the ending.", cp, BRAND_CONTRAST.primaryOnWhite)}
            {colorRow("secondary", "Accent colour", "Taglines and supporting text.", cs, BRAND_CONTRAST.secondaryOnWhite)}
          </div>
          <ul aria-label="Derived palette" className="mt-4 flex overflow-hidden rounded-lg ring-1 ring-line">
            {["primary", "primaryHover", "secondary", "secondaryLight", "surface", "border"].map((k) => (
              <li key={k} className="h-8 flex-1" style={{ background: palette[k] }} title={`${k}: ${palette[k]}`}>
                <span className="sr-only">
                  {k} {palette[k]}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Logo" description="Without a logo, your brand name is set in bold type on the ending.">
          {v.logo ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid min-h-20 min-w-40 place-items-center rounded-lg border border-line bg-white px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${v.logo.assetId}`} alt={`${v.name || "Brand"} logo`} className="max-h-16 max-w-56 object-contain" />
              </div>
              <div className="grid gap-1">
                <p className="tabular text-[13px] text-ink-2">
                  {v.logo.width}×{v.logo.height} px{v.logo.width < 400 ? " · small, so it's shown no larger than " + Math.round(v.logo.width * 1.25) + " px wide" : ""}
                </p>
                {editing ? (
                  <Button variant="quiet" size="sm" className="justify-self-start" onClick={() => set({ logo: null })}>
                    <IconTrash size={15} />
                    Use the name instead
                  </Button>
                ) : null}
              </div>
            </div>
          ) : editing ? (
            <Upload purpose="brand_logo" label="Upload logo" onUploaded={(a) => set({ logo: { assetId: a.id, width: a.width ?? 300, height: a.height ?? 100 } })} />
          ) : (
            <p className="text-sm text-ink-2">No logo — the ending shows the brand name.</p>
          )}
        </Section>

        <Section title="Calls to action" description="Saved phrases appear as suggestions when you write an ad. One per line.">
          <div className="grid gap-4 sm:grid-cols-3">
            {(["en", "ml", "hi"] as const).map((l) => (
              <Field key={l} label={{ en: "English", ml: "Malayalam", hi: "Hindi" }[l]} htmlFor={`b-cta-${l}`} optional={l !== "en"}>
                <Textarea id={`b-cta-${l}`} lang={l} rows={3} disabled={disabled} value={v.ctas[l]} placeholder={l === "en" ? `Shop now on ${v.website || "yourshop.com"}` : undefined} onChange={(e) => set({ ctas: { ...v.ctas, [l]: e.target.value } })} />
              </Field>
            ))}
            <div className="sm:col-span-2">
              <Field label="Group-deal line" htmlFor="b-gb" optional hint="Used by the group-deal template, e.g. “Buy it now, or buy together for less”.">
                <Input id="b-gb" value={v.groupBuyLine} maxLength={80} disabled={disabled} onChange={(e) => set({ groupBuyLine: e.target.value })} />
              </Field>
            </div>
            <Field label="Instagram" htmlFor="b-ig" optional>
              <Input id="b-ig" value={v.instagram} maxLength={60} disabled={disabled} placeholder="@yourshop" onChange={(e) => set({ instagram: e.target.value })} />
            </Field>
          </div>
        </Section>

        {editing ? (
          <div className="grid gap-3 border-t border-line pt-5">
            {mode === "edit" ? (
              <div className="max-w-md">
                <Field label="What changed" htmlFor="b-note" optional hint="Shown in the revision history.">
                  <Input id="b-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !validHex || !v.name.trim() || !v.website.trim()}>
                {busy ? "Saving…" : mode === "create" ? "Create brand" : "Save new revision"}
              </Button>
              {mode === "edit" ? (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setV(initial);
                    setEditing(false);
                    setError(null);
                  }}
                >
                  Discard changes
                </Button>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="whitespace-pre-line text-[13px] font-semibold text-bad">
                {error}
              </p>
            ) : null}
          </div>
        ) : error ? (
          <p role="alert" className="text-[13px] font-semibold text-bad">
            {error}
          </p>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Live preview">
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="mb-3 text-[13px] font-semibold">Live preview</p>
          <BrandPreview brand={{ name: v.name, website: v.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""), tagline: v.tagline, colors: palette, logo: v.logo ? { src: `/api/assets/${v.logo.assetId}`, width: v.logo.width, height: v.logo.height } : null, cta: lines(v.ctas.en)[0] ?? "" }} width={168} />
        </div>
      </aside>
    </form>
  );
}
