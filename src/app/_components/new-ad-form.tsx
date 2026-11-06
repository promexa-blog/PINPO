"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BrandSummary } from "@/lib/brand";
import type { TemplateCard } from "@/server/planning/template-cards";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { AspectGlyph } from "./frame";
import { SceneLegend, SceneStrip } from "./scene-strip";
import { Button, Input, api } from "./ui";
import { IconArrowRight, IconCheck, IconPlus } from "./icons";

const OUTRO_LABEL: Record<string, string> = { standard: "Logo + tagline outro", promotional: "Offer outro", product: "Product outro", minimal: "Logo-only outro" };

/** Step 0 of making an ad: brand, story template and format, as visual choices. */
export function NewAdForm({ brands, templates, initialTemplate, initialBrand }: { brands: BrandSummary[]; templates: TemplateCard[]; initialTemplate?: string; initialBrand?: string }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(brands.find((b) => b.id === initialBrand)?.id ?? brands.find((b) => b.isDefault)?.id ?? brands[0]!.id);
  const [templateKey, setTemplateKey] = useState(templates.find((t) => t.key === initialTemplate)?.key ?? templates.find((t) => t.key === "product_showcase")?.key ?? templates[0]?.key ?? "");
  const [platform, setPlatform] = useState<PlatformKey>("instagram_reels");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = templates.find((t) => t.key === templateKey);
  const brand = brands.find((b) => b.id === brandId);
  const platformOk = !template || template.platforms.includes(platform);
  const autoName = `${template?.name ?? "Ad"} – ${PLATFORMS[platform].label}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!platformOk) {
      setError(`${template?.name} isn't available for ${PLATFORMS[platform].label}. Pick another format.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ adId: string }>("/api/ads", { method: "POST", body: JSON.stringify({ name: name.trim() || autoName, templateKey, platform, brandId }) });
      router.push(`/ads/${r.adId}/edit`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const choice = (selected: boolean) =>
    `relative flex cursor-pointer flex-col rounded-xl border bg-panel p-4 text-left transition-[border-color,background-color] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${selected ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`;
  const tick = (selected: boolean) =>
    selected ? (
      <span aria-hidden className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-accent text-accent-ink">
        <IconCheck size={13} strokeWidth={2.5} />
      </span>
    ) : null;

  return (
    <form onSubmit={submit} className="mt-8 grid gap-10">
      <fieldset>
        <legend className="text-base font-semibold">Brand</legend>
        <p className="mt-1 text-[13px] text-ink-2">Its colours, logo and website go on the overlays and the closing frame.</p>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(14rem,100%),1fr))] gap-3">
          {brands.map((b) => (
            <label key={b.id} className={choice(b.id === brandId)}>
              <input type="radio" name="brand" value={b.id} checked={b.id === brandId} onChange={() => setBrandId(b.id)} className="sr-only" />
              {tick(b.id === brandId)}
              <span className="flex items-center gap-3 pr-6">
                <span aria-hidden className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-line">
                  <span className="h-8 w-5" style={{ background: b.primary }} />
                  <span className="h-8 w-3" style={{ background: b.secondary }} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{b.name}</span>
                  <span className="block truncate text-xs text-ink-2">{b.website}</span>
                </span>
              </span>
            </label>
          ))}
          <Link href="/brands/new?next=new" className="flex min-h-[4.5rem] items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-sm font-semibold text-ink-2 hover:border-accent hover:text-ink">
            <IconPlus size={16} />
            Add a brand
          </Link>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold">Story</legend>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-ink-2">A template sets the order and timing of scenes. Each bar is one scene at 30 seconds.</p>
          <SceneLegend />
        </div>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-3">
          {templates.map((t) => (
            <label key={t.key} className={choice(t.key === templateKey)}>
              <input type="radio" name="template" value={t.key} checked={t.key === templateKey} onChange={() => {
                  setTemplateKey(t.key);
                  if (!t.platforms.includes(platform) && t.platforms[0]) setPlatform(t.platforms[0] as PlatformKey);
                }} className="sr-only" />
              {tick(t.key === templateKey)}
              <span className="pr-6 font-semibold">{t.name}</span>
              <span className="mt-1 line-clamp-2 text-[13px] text-ink-2">{t.description}</span>
              <span className="mt-auto block pt-4">
                <SceneStrip scenes={t.scenes} />
              </span>
              <span className="mt-2 text-xs text-ink-3">
                {t.builtin ? "" : "Your template · "}
                {OUTRO_LABEL[t.defaultOutro] ?? t.defaultOutro}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold">Where it runs</legend>
        <p className="mt-1 text-[13px] text-ink-2">Sets the shape, the export size and the area kept clear of the app&apos;s buttons. You can change it later.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.values(PLATFORMS).map((p) => {
            const allowed = !template || template.platforms.includes(p.key);
            const selected = p.key === platform;
            return (
              <label key={p.key} className={`${choice(selected)} items-center gap-3 text-center ${allowed ? "" : "opacity-45"}`}>
                <input type="radio" name="platform" value={p.key} checked={selected} disabled={!allowed} onChange={() => setPlatform(p.key)} className="sr-only" />
                <span aria-hidden className={`grid h-16 place-items-center ${selected ? "text-accent-text" : "text-ink-2"}`}>
                  <AspectGlyph aspect={p.aspect} size={48} />
                </span>
                <span className="text-sm font-semibold leading-tight">{p.label}</span>
                <span className="tabular -mt-2 text-xs text-ink-3">
                  {p.aspect} · {p.width}×{p.height}
                  {allowed ? "" : " · not for this template"}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="max-w-md">
        <label htmlFor="ad-name" className="text-base font-semibold">
          Name <span className="text-sm font-normal text-ink-3">optional</span>
        </label>
        <Input id="ad-name" className="mt-3" value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} maxLength={120} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="min-w-0 text-sm text-ink-2" aria-live="polite">
            <span className="font-semibold text-ink">{brand?.name}</span> · {template?.name} · {PLATFORMS[platform].label}
            {!platformOk ? <span className="ml-2 font-semibold text-bad">Format not available for this template</span> : null}
          </p>
          <Button type="submit" disabled={busy || !templateKey || !platformOk}>
            {busy ? "Creating…" : "Continue"}
            <IconArrowRight size={17} />
          </Button>
          {error ? (
            <p role="alert" className="w-full text-sm font-semibold text-bad">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
