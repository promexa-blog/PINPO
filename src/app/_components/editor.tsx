"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VersionView } from "@/server/views";
import { CATEGORY_LABEL, LANG_LABEL, type BriefInput, type Lang } from "@/lib/brief";
import { PLATFORMS } from "@/lib/platforms";
import type { Finishing, SceneEdit, VersionSettings, VoiceoverSegment } from "@/lib/version";
import { Waveform } from "./waveform";
import { Button, Checkbox, Field, Input, Section, Select, Status, Textarea, api, usd } from "./ui";
import { Upload } from "./upload";

type SaveState = "saved" | "saving" | "dirty" | "conflict" | "error";
interface Draft {
  brief: BriefInput;
  settings: VersionSettings;
  finishing: Finishing;
  platform: VersionView["version"]["platform"];
  pacing: VersionView["version"]["pacing"];
  scenes: SceneEdit[];
  voiceovers: VoiceoverSegment[];
}

interface ModelInfo {
  id: VersionSettings["modelId"];
  label: string;
  summary: string;
  resolutions: VersionSettings["resolution"][];
  aspects: string[];
  audio: "toggle" | "always" | "none";
  references: { max: number } | null;
  notes: string | null;
}
const RES_LABEL: Record<string, string> = { "480p": "480p — draft", "720p": "720p — standard", "1080p": "1080p — high" };
const CAMERAS = ["static", "slow push-in", "pull-out", "orbit", "pan", "top-down", "handheld", "macro"] as const;
const LIGHTING = ["soft studio", "natural daylight", "golden hour", "moody low-key", "high-key bright"] as const;
const TRANSITIONS = ["cut", "crossfade", "dip_white", "dip_primary", "slide"] as const;
const LAYOUTS = ["lower_third", "centered", "side_panel", "corner_badge", "split_headline"] as const;
const SCENE_TYPE_LABEL: Record<SceneEdit["sceneType"], string> = { product_original: "Original product", ai_from_product: "AI from product", ai_reference: "AI with references", ai_scene: "AI scene" };
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function Editor({ versionId, adId }: { versionId: string; adId: string }) {
  const router = useRouter();
  const [view, setView] = useState<VersionView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const revision = useRef(0);
  const pending = useRef<Partial<Draft> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const v = await api<VersionView>(`/api/versions/${versionId}`);
    if (v.version.status !== "draft") {
      router.replace(`/ads/${adId}`);
      return;
    }
    revision.current = v.version.revision;
    setView(v);
    setDraft({ brief: v.brief, settings: v.settings, finishing: v.finishing, platform: v.version.platform, pacing: v.version.pacing, scenes: v.scenes.map(({ status: _s, clipAssetId: _c, job: _j, id: _id, ...s }) => s), voiceovers: v.voiceovers.map(({ id: _i, durationS: _d, talentConsent: _t, commercialUse: _c, ...vo }) => vo) });
  }, [versionId, adId, router]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const m = await api<{ models: ModelInfo[] }>("/api/models");
        if (alive) setModels(m.models);
        await load();
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const flush = useCallback(async () => {
    const body = pending.current;
    if (!body) return;
    // Unfinished benefit rows (empty text) stay local until they have text.
    if (body.brief) body.brief = { ...body.brief, claims: body.brief.claims.filter((c) => c.text.trim()) };
    pending.current = null;
    setSave("saving");
    try {
      const r = await api<{ revision: number }>(`/api/versions/${versionId}`, { method: "PATCH", body: JSON.stringify({ revision: revision.current, ...body }) });
      revision.current = r.revision;
      setSave(pending.current ? "dirty" : "saved");
      const v = await api<VersionView>(`/api/versions/${versionId}`);
      setView(v);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setSave(status === 409 ? "conflict" : "error");
      setError((e as Error).message);
    }
  }, [versionId]);

  // Autosave (plan §13): debounced 800 ms, revision-checked.
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    pending.current = { ...(pending.current ?? {}), ...patch };
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  };

  if (error && !draft) return <p role="alert">{error}</p>;
  if (!draft || !view) return <p className="py-10 text-sm text-dm-secondary">Loading…</p>;
  const { brief, settings, finishing } = draft;
  const setBrief = (b: Partial<BriefInput>) => update({ brief: { ...brief, ...b } });
  const platform = PLATFORMS[draft.platform];
  const model = models.find((m) => m.id === settings.modelId);
  const check = view.check;

  async function buildStoryboard(confirm = false) {
    if (timer.current) clearTimeout(timer.current);
    await flush();
    setBusy("storyboard");
    try {
      const res = await fetch(`/api/versions/${versionId}/storyboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm }) });
      const body = (await res.json()) as { applied: boolean; editedScenes: number[] };
      if (!body.applied && body.editedScenes?.length) {
        if (window.confirm(`Scenes ${body.editedScenes.join(", ")} have your edits. Replace them with a fresh storyboard?`)) return buildStoryboard(true);
      } else if (!res.ok) throw new Error("Couldn't build the storyboard.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (timer.current) clearTimeout(timer.current);
    await flush();
    setBusy("generate");
    setError(null);
    try {
      await api(`/api/versions/${versionId}/generate`, { method: "POST" });
      router.push(`/ads/${adId}`);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const sceneUpdate = (i: number, patch: Partial<SceneEdit>) => update({ scenes: draft.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const claims = brief.claims;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="grid gap-6">
        <Section id="product" title="Product" description="What the ad sells. Product scenes use your original photo, so add a clear one.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" htmlFor="p-name">
              <Input id="p-name" placeholder="e.g. Steel Lunch Box" value={brief.product.name} maxLength={80} onChange={(e) => setBrief({ product: { ...brief.product, name: e.target.value } })} />
            </Field>
            <Field label="Category" htmlFor="p-cat">
              <Select id="p-cat" value={brief.product.category} onChange={(e) => setBrief({ product: { ...brief.product, category: e.target.value as BriefInput["product"]["category"] } })}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="How the product looks" htmlFor="p-look" hint="Colour, material, size, packaging, any text on it. AI scenes must keep these exactly.">
                <Textarea id="p-look" placeholder="e.g. A brushed stainless-steel three-tier lunch box with a matte black clip handle, 18 cm tall" value={brief.product.appearance} maxLength={600} onChange={(e) => setBrief({ product: { ...brief.product, appearance: e.target.value } })} />
              </Field>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <p className="text-sm font-semibold">Product photos</p>
            <ul className="flex flex-wrap gap-3">
              {brief.product.imageAssetIds.map((id) => (
                <li key={id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${id}`} alt="Product photo" className="size-24 rounded-lg border border-dm-border bg-dm-surface object-contain" />
                  <button type="button" aria-label="Remove photo" className="absolute -right-2 -top-2 size-7 rounded-full bg-dm-primary text-xs text-white" onClick={() => setBrief({ product: { ...brief.product, imageAssetIds: brief.product.imageAssetIds.filter((x) => x !== id) } })}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <Upload purpose="product_image" label="Add a product photo" onUploaded={(a) => setBrief({ product: { ...brief.product, imageAssetIds: [...brief.product.imageAssetIds, a.id].slice(0, 9) } })} />
          </div>
        </Section>

        <Section id="audience" title="Audience and goal">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Who is it for?" htmlFor="a-who">
              <Input id="a-who" placeholder="e.g. Young office workers in Kochi" value={brief.audience.who} maxLength={200} onChange={(e) => setBrief({ audience: { ...brief.audience, who: e.target.value } })} />
            </Field>
            <Field label="Where?" htmlFor="a-loc">
              <Input id="a-loc" value={brief.audience.location} maxLength={100} onChange={(e) => setBrief({ audience: { ...brief.audience, location: e.target.value } })} />
            </Field>
            <Field label="Goal" htmlFor="a-obj">
              <Select id="a-obj" value={brief.campaign.objective} onChange={(e) => setBrief({ campaign: { ...brief.campaign, objective: e.target.value as BriefInput["campaign"]["objective"] } })}>
                <option value="sales">Sales</option>
                <option value="traffic">Visits to demandmesh.shop</option>
                <option value="awareness">Brand awareness</option>
                <option value="group_buy">Group-buy sign-ups</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section id="benefits" title="Benefits" description="Only confirmed benefits appear on screen, word for word. Health, safety, performance, comparison and eco claims need evidence and your confirmation.">
          <ul className="grid gap-4">
            {claims.map((c, i) => {
              const set = (patch: Partial<typeof c>) => setBrief({ claims: claims.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <li key={c.id ?? i} className="grid gap-3 rounded-lg border border-dm-border p-3 sm:grid-cols-[1fr_140px]">
                  <Field label={`Benefit ${i + 1}`} htmlFor={`c-${i}`}>
                    <Input id={`c-${i}`} value={c.text} maxLength={160} onChange={(e) => set({ text: e.target.value })} />
                  </Field>
                  <Field label="Language" htmlFor={`cl-${i}`}>
                    <Select id={`cl-${i}`} value={c.language} onChange={(e) => set({ language: e.target.value as Lang })}>
                      {Object.entries(LANG_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid gap-2 sm:col-span-2">
                    <Checkbox id={`cc-${i}`} checked={c.confirmed} onChange={(v) => set({ confirmed: v })} label="This is true for this product." />
                    <details>
                      <summary className="cursor-pointer text-sm text-dm-secondary">Evidence (needed for health, safety, performance, comparison or eco claims)</summary>
                      <div className="mt-2 grid gap-2">
                        <Input aria-label="Evidence" placeholder="Lab report, certificate or link" value={c.substantiation ?? ""} maxLength={500} onChange={(e) => set({ substantiation: e.target.value })} />
                        <Checkbox id={`ca-${i}`} checked={c.attested} onChange={(v) => set({ attested: v })} label="I checked this evidence supports the claim." />
                      </div>
                    </details>
                    <Button type="button" variant="quiet" className="justify-self-start px-0" onClick={() => setBrief({ claims: claims.filter((_, j) => j !== i) })}>
                      Remove benefit
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Button type="button" variant="secondary" className="mt-3" disabled={claims.length >= 12} onClick={() => setBrief({ claims: [...claims, { language: finishing.outroLang, text: "", confirmed: false, attested: false, testimonialConsent: false }] })}>
            Add benefit
          </Button>
        </Section>

        <Section id="offer" title="Price and offer" description="Prices are shown exactly as entered here. The discount is calculated for you.">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Selling price (₹)" htmlFor="o-price">
              <Input id="o-price" inputMode="decimal" value={brief.offers.priceInr ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, priceInr: e.target.value ? Number(e.target.value) : null } })} />
            </Field>
            <Field label="MRP (₹)" htmlFor="o-mrp">
              <Input id="o-mrp" inputMode="decimal" value={brief.offers.mrpInr ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, mrpInr: e.target.value ? Number(e.target.value) : null } })} />
            </Field>
            <Field label="Offer ends" htmlFor="o-until">
              <Input id="o-until" type="date" value={brief.offers.validUntil ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, validUntil: e.target.value || null } })} />
            </Field>
            <Field label="Price last checked" htmlFor="o-conf" hint={brief.offers.confirmedOn ? undefined : "Not confirmed yet"}>
              <div className="flex gap-2">
                <Input id="o-conf" readOnly value={brief.offers.confirmedOn ?? ""} />
                <Button type="button" variant="secondary" onClick={() => setBrief({ offers: { ...brief.offers, confirmedOn: today() } })}>
                  Today
                </Button>
              </div>
            </Field>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Group buy (optional)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="Group price (₹)" htmlFor="g-price">
                <Input id="g-price" inputMode="decimal" value={brief.offers.groupBuy?.groupPriceInr ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, groupBuy: e.target.value ? { groupPriceInr: Number(e.target.value), minBuyers: brief.offers.groupBuy?.minBuyers ?? 5, deadline: brief.offers.groupBuy?.deadline ?? today() } : null } })} />
              </Field>
              <Field label="People needed" htmlFor="g-min">
                <Input id="g-min" type="number" min={2} disabled={!brief.offers.groupBuy} value={brief.offers.groupBuy?.minBuyers ?? ""} onChange={(e) => brief.offers.groupBuy && setBrief({ offers: { ...brief.offers, groupBuy: { ...brief.offers.groupBuy, minBuyers: Number(e.target.value) } } })} />
              </Field>
              <Field label="Join by" htmlFor="g-deadline">
                <Input id="g-deadline" type="date" disabled={!brief.offers.groupBuy} value={brief.offers.groupBuy?.deadline ?? ""} onChange={(e) => brief.offers.groupBuy && setBrief({ offers: { ...brief.offers, groupBuy: { ...brief.offers.groupBuy, deadline: e.target.value } } })} />
              </Field>
            </div>
          </details>
        </Section>

        <Section id="creative" title="Call to action and style">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ad language" htmlFor="f-lang" hint="Overlays and outro use this language.">
              <Select id="f-lang" value={finishing.outroLang} onChange={(e) => update({ finishing: { ...finishing, outroLang: e.target.value as Lang }, brief: { ...brief, languages: [e.target.value as Lang] } })}>
                {Object.entries(LANG_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Call to action (${LANG_LABEL[finishing.outroLang]})`} htmlFor="f-cta">
              <Input id="f-cta" value={brief.cta[finishing.outroLang] ?? ""} maxLength={80} onChange={(e) => setBrief({ cta: { ...brief.cta, [finishing.outroLang]: e.target.value } })} />
            </Field>
            <Field label="Tone" htmlFor="f-tone">
              <Select id="f-tone" value={brief.creative.tone} onChange={(e) => setBrief({ creative: { ...brief.creative, tone: e.target.value as BriefInput["creative"]["tone"] } })}>
                {["friendly", "premium", "energetic", "calm", "informative"].map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Visual style" htmlFor="f-style">
              <Select id="f-style" value={brief.creative.style} onChange={(e) => setBrief({ creative: { ...brief.creative, style: e.target.value as BriefInput["creative"]["style"] } })}>
                {["lifestyle", "studio", "minimal", "bold"].map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Creative direction (optional)" htmlFor="f-dir" hint="Mood, setting, story idea. Added to AI scene prompts — don't add claims here.">
                <Input id="f-dir" value={brief.creative.direction} maxLength={500} onChange={(e) => setBrief({ creative: { ...brief.creative, direction: e.target.value } })} />
              </Field>
            </div>
          </div>
        </Section>

        <Section id="format" title="Format, length and quality">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Platform" htmlFor="s-platform" hint={`${platform.aspect} · ${platform.width}×${platform.height}`}>
              <Select id="s-platform" value={draft.platform} onChange={(e) => update({ platform: e.target.value as Draft["platform"] })}>
                {Object.values(PLATFORMS).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Length" htmlFor="s-len">
              <Select id="s-len" value={settings.lengthS} onChange={(e) => update({ settings: { ...settings, lengthS: Number(e.target.value) as VersionSettings["lengthS"] } })}>
                {platform.lengths.map((l) => (
                  <option key={l} value={l}>
                    {l} seconds
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pacing" htmlFor="s-pace">
              <Select id="s-pace" value={draft.pacing} onChange={(e) => update({ pacing: e.target.value as Draft["pacing"] })}>
                <option value="calm">Calm</option>
                <option value="standard">Standard</option>
                <option value="fast">Fast</option>
              </Select>
            </Field>
            <Field label="Video model" htmlFor="s-model" hint={model?.summary}>
              <Select
                id="s-model"
                value={settings.modelId}
                onChange={(e) => {
                  const next = models.find((m) => m.id === e.target.value);
                  if (!next) return;
                  update({ settings: { ...settings, modelId: next.id, resolution: next.resolutions.includes(settings.resolution) ? settings.resolution : next.resolutions[next.resolutions.length > 1 ? 1 : 0]!, clipAudio: next.audio === "toggle" ? settings.clipAudio : next.audio === "always" } });
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.aspects.includes(platform.aspect)}>
                    {m.label}
                    {!m.aspects.includes(platform.aspect) ? ` (no ${platform.aspect})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quality" htmlFor="s-res" hint={model?.notes ?? undefined}>
              <Select id="s-res" value={settings.resolution} onChange={(e) => update({ settings: { ...settings, resolution: e.target.value as VersionSettings["resolution"] } })}>
                {(model?.resolutions ?? ["720p"]).map((r) => (
                  <option key={r} value={r}>
                    {RES_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="self-end">
              <Checkbox
                id="s-audio"
                checked={settings.clipAudio}
                onChange={(v) => update({ settings: { ...settings, clipAudio: v } })}
                label="Keep AI scene sound"
                hint={model?.audio === "toggle" ? `${model.label} can generate sound.` : model?.audio === "always" ? `${model.label} always generates sound; untick to mute it.` : "This model has no sound; your music is used."}
              />
            </div>
            <Field label="Outro" htmlFor="s-outro" hint="Every outro uses the official logo and demandmesh.shop.">
              <Select id="s-outro" value={finishing.outroType} onChange={(e) => update({ finishing: { ...finishing, outroType: e.target.value as Finishing["outroType"] } })}>
                <option value="standard">Standard — logo, tagline, call to action</option>
                <option value="promotional">Promotional — repeats the offer</option>
                <option value="product">Product — your product photo and price</option>
                <option value="minimal">Minimal — logo only</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 grid gap-3">
            <p className="text-sm font-semibold">Music</p>
            {finishing.musicAssetId ? (
              <div className="flex flex-wrap items-center gap-3">
                <audio controls src={`/api/assets/${finishing.musicAssetId}`} className="max-w-full" />
                <Button type="button" variant="quiet" onClick={() => update({ finishing: { ...finishing, musicAssetId: null } })}>
                  Remove music
                </Button>
              </div>
            ) : (
              <Upload purpose="music" label="Add background music" onUploaded={(a) => update({ finishing: { ...finishing, musicAssetId: a.id, audioMode: settings.clipAudio ? "mix" : "music_only" } })} />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Music volume (${finishing.musicVolumeDb} dB)`} htmlFor="m-vol">
                <input id="m-vol" type="range" min={-30} max={6} step={1} value={finishing.musicVolumeDb} onChange={(e) => update({ finishing: { ...finishing, musicVolumeDb: Number(e.target.value) } })} className="accent-[#0C1C28]" />
              </Field>
              <Field label="Sound mix" htmlFor="m-mode">
                <Select id="m-mode" value={finishing.audioMode} onChange={(e) => update({ finishing: { ...finishing, audioMode: e.target.value as Finishing["audioMode"] } })}>
                  <option value="music_only">Music only</option>
                  <option value="mix">Music, lowered under scene sound</option>
                  <option value="clip_only">Scene sound only</option>
                </Select>
              </Field>
            </div>
          </div>
        </Section>

        <Section
          id="storyboard"
          title="Storyboard"
          description="Built from your brief and the template. Change camera, lighting, setting and timing per scene — brand graphics stay consistent."
          actions={
            <Button type="button" onClick={() => buildStoryboard(false)} disabled={busy !== null}>
              {busy === "storyboard" ? "Building…" : draft.scenes.length ? "Rebuild storyboard" : "Build storyboard"}
            </Button>
          }
        >
          {draft.scenes.length === 0 ? (
            <p className="text-sm text-dm-secondary">Fill in the brief above, then build the storyboard.</p>
          ) : (
            <ol className="grid gap-4">
              {draft.scenes.map((s, i) => (
                <li key={i} className="rounded-lg border border-dm-border p-3">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">
                      {i + 1}. {s.label}
                    </span>
                    <Status tone={s.sceneType === "product_original" ? "ok" : "neutral"}>{SCENE_TYPE_LABEL[s.sceneType]}</Status>
                    <span className="text-xs text-dm-secondary">{s.visualDirection}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Seconds" htmlFor={`d-${i}`}>
                      <Input id={`d-${i}`} type="number" step={0.5} min={2} max={15} value={s.durationS} onChange={(e) => sceneUpdate(i, { durationS: Number(e.target.value) })} />
                    </Field>
                    <Field label="Camera" htmlFor={`cam-${i}`}>
                      <Select id={`cam-${i}`} value={s.creative.camera} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, camera: e.target.value as SceneEdit["creative"]["camera"] } })}>
                        {CAMERAS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Lighting" htmlFor={`light-${i}`}>
                      <Select id={`light-${i}`} value={s.creative.lighting} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, lighting: e.target.value as SceneEdit["creative"]["lighting"] } })}>
                        {LIGHTING.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Then" htmlFor={`tr-${i}`}>
                      <Select id={`tr-${i}`} value={s.creative.transitionOut} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, transitionOut: e.target.value as SceneEdit["creative"]["transitionOut"] } })}>
                        {TRANSITIONS.map((c) => (
                          <option key={c} value={c}>
                            {label(c)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Setting" htmlFor={`set-${i}`}>
                        <Input id={`set-${i}`} value={s.creative.setting} maxLength={200} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, setting: e.target.value } })} />
                      </Field>
                    </div>
                    <Field label="Text layout" htmlFor={`lay-${i}`}>
                      <Select id={`lay-${i}`} value={s.overlay.layout} onChange={(e) => sceneUpdate(i, { overlay: { ...s.overlay, layout: e.target.value as SceneEdit["overlay"]["layout"] } })}>
                        {LAYOUTS.map((c) => (
                          <option key={c} value={c}>
                            {label(c)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {s.sceneType !== "product_original" ? (
                      <div className="sm:col-span-4">
                        <Field label="Video prompt" htmlFor={`pr-${i}`} hint="Sent to the video model. Text and logos are added by the studio, not the AI.">
                          <Textarea id={`pr-${i}`} value={s.prompt} maxLength={2000} onChange={(e) => sceneUpdate(i, { prompt: e.target.value })} />
                        </Field>
                      </div>
                    ) : null}
                    <div className="sm:col-span-4">
                      <p className="text-xs font-semibold text-dm-secondary">On-screen text</p>
                      <p className="text-sm">
                        {(s.overlay.byLang[finishing.outroLang] ?? []).map((l, k) => (
                          <span key={k} className={`mr-2 inline-block rounded px-1.5 py-0.5 ${l.kind === "placeholder" ? "border border-dashed border-dm-primary font-semibold" : "bg-dm-surface"}`}>
                            {l.text}
                          </span>
                        ))}
                        {(s.overlay.byLang[finishing.outroLang] ?? []).length === 0 ? <span className="text-dm-secondary">None</span> : null}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section id="voiceover" title="Voiceover" description="Upload recorded narration, attach it to a scene and set when it starts. Music is lowered automatically while the voice speaks.">
          {draft.scenes.length === 0 ? (
            <p className="text-sm text-dm-secondary">Build the storyboard first, then attach voiceover to its scenes.</p>
          ) : (
            <div className="grid gap-4">
              {draft.voiceovers.map((vo, i) => {
                const setVo = (patch: Partial<VoiceoverSegment>) => update({ voiceovers: draft.voiceovers.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                const info = view.voiceovers.find((x) => x.assetId === vo.assetId);
                return (
                  <div key={`${vo.assetId}-${i}`} className="grid gap-3 rounded-lg border border-dm-border p-3">
                    <Waveform assetId={vo.assetId} label={`voiceover ${i + 1}`} />
                    <div className="grid gap-3 sm:grid-cols-5">
                      <Field label="Scene" htmlFor={`vo-s-${i}`}>
                        <Select id={`vo-s-${i}`} value={vo.scenePosition} onChange={(e) => setVo({ scenePosition: Number(e.target.value) })}>
                          {draft.scenes.map((sc, k) => (
                            <option key={k} value={k}>
                              {k + 1}. {sc.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Starts after (s)" htmlFor={`vo-o-${i}`}>
                        <Input id={`vo-o-${i}`} type="number" min={0} max={30} step={0.1} value={vo.offsetS} onChange={(e) => setVo({ offsetS: Number(e.target.value) })} />
                      </Field>
                      <Field label={`Volume (${vo.volumeDb} dB)`} htmlFor={`vo-v-${i}`}>
                        <input id={`vo-v-${i}`} type="range" min={-20} max={10} step={1} value={vo.volumeDb} onChange={(e) => setVo({ volumeDb: Number(e.target.value) })} className="accent-[#0C1C28]" />
                      </Field>
                      <Field label="Fade in / out (s)" htmlFor={`vo-f-${i}`}>
                        <div className="flex gap-2">
                          <Input id={`vo-f-${i}`} aria-label="Fade in seconds" type="number" min={0} max={3} step={0.1} value={vo.fadeInS} onChange={(e) => setVo({ fadeInS: Number(e.target.value) })} />
                          <Input aria-label="Fade out seconds" type="number" min={0} max={3} step={0.1} value={vo.fadeOutS} onChange={(e) => setVo({ fadeOutS: Number(e.target.value) })} />
                        </div>
                      </Field>
                      <div className="flex flex-col justify-end gap-2">
                        <Checkbox id={`vo-m-${i}`} checked={vo.muted} onChange={(v) => setVo({ muted: v })} label="Mute" />
                        <Button type="button" variant="quiet" className="justify-start px-0" onClick={() => update({ voiceovers: draft.voiceovers.filter((_, j) => j !== i) })}>
                          Remove
                        </Button>
                      </div>
                    </div>
                    {info ? (
                      <p className="text-xs text-dm-secondary">
                        {info.durationS ? `${info.durationS.toFixed(1)}s long. ` : ""}
                        {info.talentConsent ? "Voice artist consent recorded." : "No voice artist consent recorded — export will be blocked."}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {draft.voiceovers.length < 12 ? <Upload purpose="voiceover" label="Add a voiceover recording" onUploaded={(a) => update({ voiceovers: [...draft.voiceovers, { assetId: a.id, scenePosition: 0, offsetS: 0, volumeDb: 0, fadeInS: 0.1, fadeOutS: 0.2, muted: false }] })} /> : null}
              <Checkbox id="vo-duck" checked={finishing.duckClipUnderVoice} onChange={(v) => update({ finishing: { ...finishing, duckClipUnderVoice: v } })} label="Also lower AI scene sound while the voice speaks" />
            </div>
          )}
        </Section>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="grid gap-4 rounded-xl border border-dm-border bg-dm-surface p-4">
          <p className="text-xs font-semibold" aria-live="polite">
            {{ saved: "All changes saved", saving: "Saving…", dirty: "Unsaved changes…", conflict: "Changed in another tab — reload", error: "Couldn't save" }[save]}
          </p>
          <div>
            <p className="text-sm font-bold">{platform.label}</p>
            <p className="text-sm text-dm-secondary">
              {check?.timeline ? `${check.timeline.totalS.toFixed(1)}s of ${settings.lengthS}s` : `${settings.lengthS}s`} · {settings.resolution} · {draft.scenes.length} scenes
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-dm-secondary">Estimated cost (list prices)</p>
            <p className="text-2xl font-bold">{usd(check?.estimate?.totalUsd ?? 0)}</p>
            <p className="text-xs text-dm-secondary">An estimate, not a bill. Original-product scenes are free.</p>
          </div>
          {check && check.blocking.length > 0 ? (
            <div>
              <p className="text-sm font-bold">Before you generate</p>
              <ul className="mt-2 grid gap-2 text-sm">
                {check.blocking.map((b, i) => (
                  <li key={i} className="border-l-2 border-dm-primary pl-2">
                    {b.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {check && check.warnings.length > 0 ? (
            <div>
              <p className="text-sm font-bold">Worth checking</p>
              <ul className="mt-2 grid gap-2 text-sm text-dm-secondary">
                {check.warnings.map((b, i) => (
                  <li key={i}>{b.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Button type="button" onClick={generate} disabled={busy !== null || !check?.ok || save === "conflict"}>
            {busy === "generate" ? "Starting…" : `Generate version ${view.version.number}`}
          </Button>
          {error ? (
            <p role="alert" className="whitespace-pre-line text-sm font-semibold">
              {error}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
