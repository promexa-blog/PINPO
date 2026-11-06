"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VersionView } from "@/server/views";
import { CATEGORY_LABEL, LANG_LABEL, type BriefInput, type Lang } from "@/lib/brief";
import { PLATFORMS } from "@/lib/platforms";
import type { Finishing, SceneEdit, VersionSettings, VoiceoverSegment } from "@/lib/version";
import type { BrandColors } from "@/lib/brand-layout/tokens";
import { Waveform } from "./waveform";
import { FramePreview } from "./frame-preview";
import { AspectGlyph } from "./frame";
import { Button, Checkbox, Field, Input, Notice, Section, Select, Status, Textarea, api, usd } from "./ui";
import { Upload } from "./upload";
import { StoryboardTimeline } from "./storyboard-timeline";
import { useFeedback } from "./feedback";
import { IconAlert, IconArrowDown, IconArrowLeft, IconArrowUp, IconArrowRight, IconCheck, IconFilm, IconImage, IconMusic, IconPlay, IconPlus, IconRefresh, IconSliders, IconText, IconTrash, IconX } from "./icons";

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

const STEPS = [
  { key: "product", label: "Product", icon: IconImage, title: "The product", intro: "What the ad sells. Hero and closing shots animate your real photo, so add a clear one." },
  { key: "message", label: "Message", icon: IconText, title: "The message", intro: "Who it's for and what's true about it. Only benefits you confirm appear on screen, word for word." },
  { key: "format", label: "Format", icon: IconSliders, title: "Format and quality", intro: "Where it runs, how long it is, which video model makes the AI scenes, and how it ends." },
  { key: "storyboard", label: "Storyboard", icon: IconFilm, title: "Storyboard", intro: "Built from your brief and template. Adjust camera, lighting, setting and timing per scene — your brand graphics stay consistent." },
  { key: "sound", label: "Sound", icon: IconMusic, title: "Music and voice", intro: "Optional. Background music is lowered automatically under any voiceover." },
  { key: "review", label: "Generate", icon: IconPlay, title: "Review and generate", intro: "Check the summary, fix anything listed, then generate. You can keep editing a new version afterwards." },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const STEP_OF_CHECK = (check: string, message: string): StepKey => {
  if (check === "brief") return /who the ad is for/i.test(message) ? "message" : "product";
  if (["cta_presence", "product_claim_accuracy", "offer_accuracy"].includes(check)) return "message";
  if (["length", "model", "outro", "cost"].includes(check)) return "format";
  if (["voiceover", "audio"].includes(check)) return "sound";
  return "storyboard";
};

const RES_LABEL: Record<string, string> = { "480p": "480p · draft", "720p": "720p · standard", "1080p": "1080p · high" };
const CAMERAS = ["static", "slow push-in", "pull-out", "orbit", "pan", "top-down", "handheld", "macro"] as const;
const LIGHTING = ["soft studio", "natural daylight", "golden hour", "moody low-key", "high-key bright"] as const;
const TRANSITIONS = ["cut", "crossfade", "dip_white", "dip_primary", "slide"] as const;
const LAYOUTS = ["lower_third", "centered", "side_panel", "corner_badge", "split_headline"] as const;
const SCENE_TYPE: Record<SceneEdit["sceneType"], { label: string; tone: "accent" | "neutral" }> = {
  product_original: { label: "Real product photo", tone: "accent" },
  ai_from_product: { label: "AI from your photo", tone: "neutral" },
  ai_reference: { label: "AI with references", tone: "neutral" },
  ai_scene: { label: "AI scene", tone: "neutral" },
};
const OUTROS: { value: Finishing["outroType"]; label: string; hint: string }[] = [
  { value: "standard", label: "Standard", hint: "Logo, tagline, call to action" },
  { value: "promotional", label: "Offer", hint: "Repeats the price or deal" },
  { value: "product", label: "Product", hint: "Your photo and price" },
  { value: "minimal", label: "Minimal", hint: "Logo and website only" },
];
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const stepFromHash = (): StepKey => {
  if (typeof window === "undefined") return "product";
  const h = window.location.hash.slice(1);
  return (STEPS.some((s) => s.key === h) ? h : "product") as StepKey;
};

export function Editor({ versionId, adId, title }: { versionId: string; adId: string; title: { name: string; meta: string } }) {
  const router = useRouter();
  const { confirm: ask, toast } = useFeedback();
  const [view, setView] = useState<VersionView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [step, setStep] = useState<StepKey>(stepFromHash);
  const revision = useRef(0);
  const pending = useRef<Partial<Draft> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

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

  // Back/forward and in-page links (#storyboard) move between steps too.
  useEffect(() => {
    const onHash = () => {
      moved.current = true;
      setStep(stepFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Moving between steps: put focus on the new step's heading (keyboard + screen readers).
  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step]);

  const inFlight = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  /**
   * Saves pending edits. One save at a time: a later save waits for the current one and then
   * sends the newest revision (no false "changed in another tab"). A failed save keeps the edits
   * and retries; callers that act on the saved draft check the result.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    while (inFlight.current) await inFlight.current;
    const body = pending.current;
    if (!body) return true;
    pending.current = null;
    // Unfinished benefit rows (empty text) stay local until they have text.
    const send = body.brief ? { ...body, brief: { ...body.brief, claims: body.brief.claims.filter((c) => c.text.trim()) } } : body;
    setSave("saving");
    const run = (async () => {
      try {
        const r = await api<{ revision: number }>(`/api/versions/${versionId}`, { method: "PATCH", body: JSON.stringify({ revision: revision.current, ...send }) });
        revision.current = r.revision;
        setSave(pending.current ? "dirty" : "saved");
        setView(await api<VersionView>(`/api/versions/${versionId}`));
        return true;
      } catch (e) {
        // Keep the unsaved edits; anything typed since is newer and wins.
        pending.current = { ...body, ...(pending.current ?? {}) };
        const status = (e as { status?: number }).status;
        setSave(status === 409 ? "conflict" : "error");
        setError((e as Error).message);
        if (status !== 409) {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flushRef.current(), 5000);
        }
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [versionId]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Autosave (plan §13): debounced 800 ms, revision-checked.
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    pending.current = { ...(pending.current ?? {}), ...patch };
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  };

  const pageTitle = (
    <div className="mx-auto max-w-7xl px-4 pb-5 pt-5 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1.5 rounded-md text-sm text-ink-2 hover:text-ink">
        <IconArrowLeft size={16} />
        All ads
      </Link>
      <h1 className="mt-2 text-[1.5rem] font-semibold leading-tight tracking-tight">{title.name}</h1>
      <p className="mt-1 text-sm text-ink-2">{title.meta}</p>
    </div>
  );
  if (error && !draft)
    return (
      <>
        {pageTitle}
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Notice tone="bad">{error}</Notice>
        </div>
      </>
    );
  if (!draft || !view)
    return (
      <>
        {pageTitle}
        <EditorSkeleton />
      </>
    );

  const { brief, settings, finishing } = draft;
  const setBrief = (b: Partial<BriefInput>) => update({ brief: { ...brief, ...b } });
  const platform = PLATFORMS[draft.platform];
  const model = models.find((m) => m.id === settings.modelId);
  const check = view.check;
  const lang = finishing.outroLang;
  const claims = brief.claims;
  const colors = view.brandColors as unknown as BrandColors;
  /** Reorders scenes; voiceovers stay attached to the scene they were on. */
  const moveScene = (from: number, to: number) => {
    const n = draft.scenes.length;
    if (to < 0 || to >= n || from === to) return;
    const order = draft.scenes.map((_, k) => k);
    const [m] = order.splice(from, 1);
    order.splice(to, 0, m!);
    update({ scenes: order.map((k) => draft.scenes[k]!), voiceovers: draft.voiceovers.map((vo) => ({ ...vo, scenePosition: order.indexOf(vo.scenePosition) })) });
    toast(`Moved “${draft.scenes[from]!.label}” to position ${to + 1}.`, "info");
  };
  const sceneUpdate = (i: number, patch: Partial<SceneEdit>) => update({ scenes: draft.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const hasPlaceholders = draft.scenes.some((s) => (s.overlay.byLang[lang] ?? []).some((l) => l.kind === "placeholder"));
  const done: Record<StepKey, boolean> = {
    product: !!brief.product.name.trim() && brief.product.appearance.trim().length >= 10 && brief.product.imageAssetIds.length > 0,
    message: !!brief.audience.who.trim() && claims.some((c) => c.confirmed && c.text.trim()) && !!brief.cta[lang]?.trim(),
    format: !(check?.blocking ?? []).some((b) => STEP_OF_CHECK(b.check, b.message) === "format"),
    storyboard: draft.scenes.length > 0 && !hasPlaceholders,
    sound: true,
    review: !!check?.ok,
  };
  const issuesFor = (k: StepKey) => (check?.blocking ?? []).filter((b) => STEP_OF_CHECK(b.check, b.message) === k).length;
  const idx = STEPS.findIndex((s) => s.key === step);
  const current = STEPS[idx]!;
  const go = (k: StepKey) => {
    moved.current = true;
    setStep(k);
    window.history.pushState(null, "", `#${k}`);
  };

  async function buildStoryboard(confirm = false) {
    if (timer.current) clearTimeout(timer.current);
    if (!(await flush())) return;
    setBusy("storyboard");
    setError(null);
    try {
      const res = await fetch(`/api/versions/${versionId}/storyboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm }) });
      const body = (await res.json()) as { applied: boolean; editedScenes: number[] };
      if (!body.applied && body.editedScenes?.length) {
        const ok = await ask({ title: "Replace your scene edits?", body: `You've changed scene ${body.editedScenes.join(", ")}. Rebuilding makes every scene fresh from the brief.`, confirmLabel: "Rebuild storyboard", danger: true });
        if (ok) return buildStoryboard(true);
        return;
      } else if (!res.ok) throw new Error("Couldn't build the storyboard. Check the brief and try again.");
      await load();
      toast(confirm ? "Storyboard rebuilt from the brief." : "Storyboard ready — adjust any scene below.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (timer.current) clearTimeout(timer.current);
    // Never generate an older draft than what's on screen.
    if (!(await flush())) return;
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

  const totalS = draft.scenes.reduce((a, s) => a + s.durationS, 0);

  return (
    <div>
      {pageTitle}

      {/* Step bar: full width like the site header, content aligned to the page container. */}
      <div className="sticky top-[57px] z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-7xl items-stretch gap-4 px-4 sm:px-6">
          <nav aria-label="Steps" className="-ml-3 hidden min-w-0 lg:flex">
            <ol className="flex items-stretch">
              {STEPS.map((s, i) => {
                const active = s.key === step;
                const issues = s.key === "review" ? 0 : issuesFor(s.key);
                const complete = done[s.key] && s.key !== "review";
                return (
                  <li key={s.key} className="flex">
                    <button
                      type="button"
                      onClick={() => go(s.key)}
                      aria-current={active ? "step" : undefined}
                      className={`relative flex h-12 items-center gap-2 px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-offset-[-4px] ${active ? "text-ink" : "text-ink-2 hover:text-ink"}`}
                    >
                      <span aria-hidden className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${complete ? "bg-ok-soft text-ok" : active ? "bg-accent text-accent-ink" : "border border-line-strong text-ink-3"}`}>
                        {complete ? <IconCheck size={12} strokeWidth={2.5} /> : i + 1}
                      </span>
                      {s.label}
                      {issues ? <span className="tabular rounded-full bg-bad-soft px-1.5 text-[11px] font-bold text-bad">{issues}</span> : null}
                      <span className="sr-only">{complete ? "(done)" : issues ? `(${issues} to fix)` : ""}</span>
                      <span aria-hidden className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* Compact stepper below lg: no scrolling strip. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2 lg:hidden">
            <Button variant="quiet" size="sm" aria-label="Previous step" disabled={idx === 0} onClick={() => go(STEPS[idx - 1]!.key)}>
              <IconArrowLeft size={16} />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="tabular text-ink-3">
                  {idx + 1}/{STEPS.length}
                </span>
                <span className="truncate">{current.label}</span>
                {issuesFor(step) && step !== "review" ? <span className="tabular rounded-full bg-bad-soft px-1.5 text-[11px] font-bold text-bad">{issuesFor(step)}</span> : null}
              </p>
              <ol aria-label="Steps" className="mt-1 flex gap-1">
                {STEPS.map((s, i) => (
                  <li key={s.key} className="flex-1">
                    <button type="button" onClick={() => go(s.key)} aria-current={s.key === step ? "step" : undefined} aria-label={`Step ${i + 1}: ${s.label}${done[s.key] && s.key !== "review" ? " (done)" : ""}`} className="flex h-5 w-full items-center">
                      <span aria-hidden className={`h-1 w-full rounded-full ${s.key === step ? "bg-accent" : done[s.key] && s.key !== "review" ? "bg-ok/60" : "bg-panel-2"}`} />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <Button variant="quiet" size="sm" aria-label="Next step" disabled={idx === STEPS.length - 1} onClick={() => go(STEPS[idx + 1]!.key)}>
              <IconArrowRight size={16} />
            </Button>
          </div>

          <div className="ml-auto hidden shrink-0 items-center gap-4 lg:flex">
            <SaveState save={save} className="hidden xl:flex" />
            <Button onClick={generate} disabled={busy !== null || !check?.ok || save === "conflict"} title={check && !check.ok ? `${check.blocking.length} thing${check.blocking.length === 1 ? "" : "s"} to fix first` : undefined}>
              <IconPlay size={15} />
              {busy === "generate" ? "Starting…" : `Generate version ${view.version.number}`}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div key={step} className="step-enter mb-5">
            <p className="hidden text-xs font-semibold text-ink-3 lg:block">
              Step {idx + 1} of {STEPS.length}
            </p>
            <h2 ref={heading} tabIndex={-1} className="mt-1 scroll-mt-32 text-xl font-semibold tracking-tight focus:outline-none">
              {current.title}
            </h2>
            <p className="mt-1 max-w-prose text-sm text-ink-2">{current.intro}</p>
          </div>

          <div key={`${step}-body`} className="step-enter grid grid-cols-[minmax(0,1fr)] gap-5">
            {step === "product" ? (
              <>
                <Section id="product" title="Basics">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Product name" htmlFor="p-name">
                      <Input id="p-name" placeholder="e.g. Steel Lunch Box" value={brief.product.name} maxLength={80} onChange={(e) => setBrief({ product: { ...brief.product, name: e.target.value } })} />
                    </Field>
                    <Field label="Category" htmlFor="p-cat" hint="Health and personal care products get stricter claim checks.">
                      <Select id="p-cat" value={brief.product.category} onChange={(e) => setBrief({ product: { ...brief.product, category: e.target.value as BriefInput["product"]["category"] } })}>
                        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="How the product looks" htmlFor="p-look" hint="Colour, material, size, packaging and any text on it. AI scenes are told to keep these exactly.">
                        <Textarea id="p-look" placeholder="e.g. A brushed stainless-steel three-tier lunch box with a matte black clip handle, 18 cm tall" value={brief.product.appearance} maxLength={600} onChange={(e) => setBrief({ product: { ...brief.product, appearance: e.target.value } })} />
                      </Field>
                    </div>
                  </div>
                </Section>
                <Section id="photos" title="Product photos" description="The first photo is used for hero shots and the product outro. Up to 9.">
                  {brief.product.imageAssetIds.length ? (
                    <ul className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
                      {brief.product.imageAssetIds.map((id, i) => (
                        <li key={id} className="relative">
                          <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-line bg-white p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/assets/${id}`} alt={`Product photo ${i + 1}`} className="max-h-full max-w-full object-contain" />
                          </div>
                          {i === 0 ? <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 text-[11px] font-bold text-accent-ink">Main</span> : null}
                          <button type="button" aria-label={`Remove photo ${i + 1}`} className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-line bg-panel text-ink-2 shadow-lift hover:text-bad" onClick={() => setBrief({ product: { ...brief.product, imageAssetIds: brief.product.imageAssetIds.filter((x) => x !== id) } })}>
                            <IconX size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {brief.product.imageAssetIds.length < 9 ? <Upload
                      purpose="product_image"
                      label={brief.product.imageAssetIds.length ? "Add more photos" : "Add product photos"}
                      multiple={9 - brief.product.imageAssetIds.length}
                      onUploadedMany={(assets) => {
                        setBrief({ product: { ...brief.product, imageAssetIds: [...brief.product.imageAssetIds, ...assets.map((a) => a.id).filter((id) => !brief.product.imageAssetIds.includes(id))].slice(0, 9) } });
                        toast(assets.length === 1 ? "Photo added." : `${assets.length} photos added.`);
                      }}
                    /> : null}
                </Section>
              </>
            ) : null}

            {step === "message" ? (
              <>
                <Section id="audience" title="Audience and goal">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Who is it for?" htmlFor="a-who">
                      <Input id="a-who" placeholder="e.g. Young office workers in Kochi" value={brief.audience.who} maxLength={200} onChange={(e) => setBrief({ audience: { ...brief.audience, who: e.target.value } })} />
                    </Field>
                    <Field label="Where?" htmlFor="a-loc">
                      <Input id="a-loc" placeholder="e.g. Kochi, Kerala" value={brief.audience.location} maxLength={100} onChange={(e) => setBrief({ audience: { ...brief.audience, location: e.target.value } })} />
                    </Field>
                    <Field label="Goal" htmlFor="a-obj">
                      <Select id="a-obj" value={brief.campaign.objective} onChange={(e) => setBrief({ campaign: { ...brief.campaign, objective: e.target.value as BriefInput["campaign"]["objective"] } })}>
                        <option value="sales">Sales</option>
                        <option value="traffic">Visits to {view.brand.website}</option>
                        <option value="awareness">Brand awareness</option>
                        <option value="group_buy">Group-deal sign-ups</option>
                      </Select>
                    </Field>
                  </div>
                </Section>

                <Section id="benefits" title="Benefits" description="Health, safety, performance, comparison and eco claims also need evidence and your confirmation.">
                  {claims.length === 0 ? <p className="mb-3 text-sm text-ink-2">No benefits yet. Add two or three things that are true about this product.</p> : null}
                  <ul className="grid gap-3">
                    {claims.map((c, i) => {
                      const set = (patch: Partial<typeof c>) => setBrief({ claims: claims.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                      return (
                        <li key={c.id ?? i} className="grid gap-3 rounded-lg border border-line bg-panel-2/40 p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
                          <Field label={`Benefit ${i + 1}`} htmlFor={`c-${i}`}>
                            <Input id={`c-${i}`} lang={c.language} value={c.text} maxLength={160} placeholder="e.g. Keeps food warm for 4 hours" onChange={(e) => set({ text: e.target.value })} />
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
                          <Button variant="quiet" aria-label={`Remove benefit ${i + 1}`} onClick={() => setBrief({ claims: claims.filter((_, j) => j !== i) })}>
                            <IconTrash size={16} />
                          </Button>
                          <div className="grid gap-2 sm:col-span-3">
                            <Checkbox id={`cc-${i}`} checked={c.confirmed} onChange={(v) => set({ confirmed: v })} label="This is true for this product." />
                            <details className="group">
                              <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-ink">Add evidence</summary>
                              <div className="mt-2 grid gap-2">
                                <Input aria-label={`Evidence for benefit ${i + 1}`} placeholder="Lab report, certificate or link" value={c.substantiation ?? ""} maxLength={500} onChange={(e) => set({ substantiation: e.target.value })} />
                                <Checkbox id={`ca-${i}`} checked={c.attested} onChange={(v) => set({ attested: v })} label="I checked this evidence supports the claim." />
                              </div>
                            </details>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <Button variant="secondary" className="mt-3" disabled={claims.length >= 12} onClick={() => setBrief({ claims: [...claims, { language: lang, text: "", confirmed: false, attested: false, testimonialConsent: false }] })}>
                    <IconPlus size={16} />
                    Add benefit
                  </Button>
                </Section>

                <Section id="offer" title="Price and offer" description="Shown exactly as entered. The discount is calculated for you.">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Field label="Selling price (₹)" htmlFor="o-price" optional>
                      <Input id="o-price" inputMode="decimal" className="tabular" value={brief.offers.priceInr ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, priceInr: e.target.value ? Number(e.target.value) : null } })} />
                    </Field>
                    <Field label="MRP (₹)" htmlFor="o-mrp" optional>
                      <Input id="o-mrp" inputMode="decimal" className="tabular" value={brief.offers.mrpInr ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, mrpInr: e.target.value ? Number(e.target.value) : null } })} />
                    </Field>
                    <Field label="Offer ends" htmlFor="o-until" optional>
                      <Input id="o-until" type="date" value={brief.offers.validUntil ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, validUntil: e.target.value || null } })} />
                    </Field>
                    <Field label="Price last checked" htmlFor="o-conf" hint={brief.offers.confirmedOn ? undefined : "Not confirmed yet"}>
                      <div className="flex gap-2">
                        <Input id="o-conf" readOnly value={brief.offers.confirmedOn ?? ""} />
                        <Button variant="secondary" onClick={() => setBrief({ offers: { ...brief.offers, confirmedOn: today() } })}>
                          Today
                        </Button>
                      </div>
                    </Field>
                  </div>
                  <details className="mt-4 rounded-lg border border-line px-3 py-2" open={!!brief.offers.groupBuy}>
                    <summary className="cursor-pointer py-1 text-sm font-semibold">Group deal</summary>
                    <p className="text-[13px] text-ink-2">A lower price when enough people buy together.</p>
                    <div className="mt-3 grid gap-4 pb-2 sm:grid-cols-3">
                      <Field label="Group price (₹)" htmlFor="g-price">
                        <Input id="g-price" inputMode="decimal" className="tabular" value={brief.offers.groupBuy?.groupPriceInr ?? ""} onChange={(e) => setBrief({ offers: { ...brief.offers, groupBuy: e.target.value ? { groupPriceInr: Number(e.target.value), minBuyers: brief.offers.groupBuy?.minBuyers ?? 5, deadline: brief.offers.groupBuy?.deadline ?? today() } : null } })} />
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Ad language" htmlFor="f-lang" hint="On-screen text and the outro use this language.">
                      <Select id="f-lang" value={lang} onChange={(e) => update({ finishing: { ...finishing, outroLang: e.target.value as Lang }, brief: { ...brief, languages: [e.target.value as Lang] } })}>
                        {Object.entries(LANG_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`Call to action (${LANG_LABEL[lang]})`} htmlFor="f-cta" hint={view.brand.approvedCtas[lang]?.length ? undefined : `No saved calls to action in ${LANG_LABEL[lang]} for ${view.brand.name} yet.`}>
                      <Input id="f-cta" lang={lang} list="cta-options" value={brief.cta[lang] ?? ""} maxLength={80} onChange={(e) => setBrief({ cta: { ...brief.cta, [lang]: e.target.value } })} />
                      <datalist id="cta-options">
                        {(view.brand.approvedCtas[lang] ?? []).map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
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
                      <Field label="Creative direction" htmlFor="f-dir" optional hint="Mood, setting or story idea for the AI scenes. Don't add claims here — they won't be checked.">
                        <Textarea id="f-dir" className="min-h-20" value={brief.creative.direction} maxLength={500} onChange={(e) => setBrief({ creative: { ...brief.creative, direction: e.target.value } })} />
                      </Field>
                    </div>
                  </div>
                </Section>
              </>
            ) : null}

            {step === "format" ? (
              <>
                <Section id="format" title="Where it runs and how long">
                  <fieldset>
                    <legend className="text-[13px] font-semibold">Platform</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {Object.values(PLATFORMS).map((p) => {
                        const sel = p.key === draft.platform;
                        return (
                          <label key={p.key} className={`relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${sel ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}>
                            <input type="radio" name="platform" className="sr-only" checked={sel} onChange={() => update({ platform: p.key })} />
                            <span className={sel ? "text-accent-text" : "text-ink-3"}>
                              <AspectGlyph aspect={p.aspect} size={22} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{p.label}</span>
                              <span className="tabular block text-xs text-ink-3">{p.aspect}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label="Length" htmlFor="s-len">
                      <Select id="s-len" value={settings.lengthS} onChange={(e) => update({ settings: { ...settings, lengthS: Number(e.target.value) as VersionSettings["lengthS"] } })}>
                        {platform.lengths.map((l) => (
                          <option key={l} value={l}>
                            {l} seconds
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Pacing" htmlFor="s-pace" hint="Changes scene timing and transitions, not the total length.">
                      <Select id="s-pace" value={draft.pacing} onChange={(e) => update({ pacing: e.target.value as Draft["pacing"] })}>
                        <option value="calm">Calm</option>
                        <option value="standard">Standard</option>
                        <option value="fast">Fast</option>
                      </Select>
                    </Field>
                  </div>
                </Section>

                <Section id="model" title="Video model and quality" description="Only AI scenes cost money. Scenes made from your real product photo are free.">
                  <div className="grid gap-4 sm:grid-cols-2">
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
                    <div className="sm:col-span-2">
                      <Checkbox
                        id="s-audio"
                        checked={settings.clipAudio}
                        onChange={(v) => update({ settings: { ...settings, clipAudio: v } })}
                        label="Keep the sound the AI generates"
                        hint={model?.audio === "toggle" ? `${model.label} can generate sound (costs a little more).` : model?.audio === "always" ? `${model.label} always generates sound; untick to mute it.` : "This model makes silent video; your music is used."}
                      />
                    </div>
                  </div>
                </Section>

                <Section id="outro" title="Ending" description={`Every ending uses ${view.brand.name}'s ${view.brand.hasLogo ? "logo" : "name as a wordmark"} and ${view.brand.website}.`}>
                  <fieldset>
                    <legend className="sr-only">Outro</legend>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                      {OUTROS.map((o) => {
                        const sel = o.value === finishing.outroType;
                        return (
                          <label key={o.value} className={`relative cursor-pointer rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${sel ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}>
                            <input type="radio" name="outro" className="sr-only" checked={sel} onChange={() => update({ finishing: { ...finishing, outroType: o.value } })} />
                            <span className="block text-sm font-semibold">{o.label}</span>
                            <span className="block text-xs text-ink-2">{o.hint}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </Section>
              </>
            ) : null}

            {step === "storyboard" ? (
              <>
                {draft.scenes.length ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel p-4">
                    <p className="text-sm text-ink-2">
                      <span className="font-semibold text-ink">{draft.scenes.length} scenes</span> · <span className="tabular">{totalS.toFixed(1)}s</span> plus a 3s ending
                    </p>
                    <Button variant="secondary" onClick={() => buildStoryboard(false)} disabled={busy !== null}>
                      <IconRefresh size={16} />
                      {busy === "storyboard" ? "Building…" : "Rebuild from brief"}
                    </Button>
                  </div>
                ) : (
                  <div className="grid place-items-center rounded-xl border border-dashed border-line-strong bg-panel px-6 py-14 text-center">
                    <span aria-hidden className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-text">
                      <IconFilm size={24} />
                    </span>
                    <h3 className="mt-4 text-base font-semibold">No storyboard yet</h3>
                    <p className="mt-1.5 max-w-md text-sm text-ink-2">PINPO plans every scene from your brief and the template — camera, setting, timing and on-screen text. You can change any of it afterwards.</p>
                    {!done.product || !done.message ? (
                      <p className="mt-3 text-[13px] font-semibold text-warn">
                        Finish{" "}
                        {[!done.product ? "Product" : null, !done.message ? "Message" : null]
                          .filter(Boolean)
                          .join(" and ")}{" "}
                        first for a complete storyboard.
                      </p>
                    ) : null}
                    <Button className="mt-5" onClick={() => buildStoryboard(false)} disabled={busy !== null}>
                      <IconRefresh size={16} />
                      {busy === "storyboard" ? "Building…" : "Build storyboard"}
                    </Button>
                  </div>
                )}
                {draft.scenes.length ? (
                  <>
                    <StoryboardTimeline
                      scenes={draft.scenes}
                      platform={draft.platform}
                      colors={colors}
                      lang={lang}
                      brand={{ name: view.brand.name, website: view.brand.website, tagline: view.brand.tagline, logo: view.brand.logo }}
                      cta={brief.cta[lang] ?? ""}
                      onMove={moveScene}
                      onJump={(i) => {
                        const el = document.getElementById(`scene-${i + 1}`);
                        el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        el?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
                      }}
                    />
                    <ol className="grid gap-4">
                      {draft.scenes.map((s, i) => {
                        const lines = s.overlay.byLang[lang] ?? [];
                        return (
                          <li key={i} id={`scene-${i + 1}`} className="scroll-mt-32 rounded-xl border border-line bg-panel p-4">
                            <div className="flex flex-col gap-5 sm:flex-row">
                              <FramePreview platform={draft.platform} colors={colors} lang={lang} layout={s.overlay.layout} lines={lines} productSrc={s.productAssetId ? `/api/assets/${s.productAssetId}` : null} aiScene={s.sceneType !== "product_original"} width={platform.aspect === "16:9" ? 260 : 168} />
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <h3 className="font-semibold">
                                    <span className="tabular text-ink-3">{i + 1}</span> {s.label}
                                  </h3>
                                  <Status tone={SCENE_TYPE[s.sceneType].tone}>{SCENE_TYPE[s.sceneType].label}</Status>
                                  <span className="ml-auto flex gap-1">
                                    <Button variant="quiet" size="sm" aria-label={`Move scene ${i + 1} earlier`} disabled={i === 0} onClick={() => moveScene(i, i - 1)}>
                                      <IconArrowUp size={15} />
                                    </Button>
                                    <Button variant="quiet" size="sm" aria-label={`Move scene ${i + 1} later`} disabled={i === draft.scenes.length - 1} onClick={() => moveScene(i, i + 1)}>
                                      <IconArrowDown size={15} />
                                    </Button>
                                  </span>
                                </div>
                                <p className="mb-4 text-[13px] text-ink-2">{s.visualDirection}</p>
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                  <Field label="Seconds" htmlFor={`d-${i}`}>
                                    <Input id={`d-${i}`} className="tabular" type="number" step={0.5} min={2} max={15} value={s.durationS} onChange={(e) => sceneUpdate(i, { durationS: Number(e.target.value) })} />
                                  </Field>
                                  <Field label="Camera" htmlFor={`cam-${i}`}>
                                    <Select id={`cam-${i}`} value={s.creative.camera} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, camera: e.target.value as SceneEdit["creative"]["camera"] } })}>
                                      {CAMERAS.map((c) => (
                                        <option key={c} value={c}>
                                          {label(c)}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <Field label="Lighting" htmlFor={`light-${i}`}>
                                    <Select id={`light-${i}`} value={s.creative.lighting} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, lighting: e.target.value as SceneEdit["creative"]["lighting"] } })}>
                                      {LIGHTING.map((c) => (
                                        <option key={c} value={c}>
                                          {label(c)}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <Field label="Then" htmlFor={`tr-${i}`}>
                                    <Select id={`tr-${i}`} value={s.creative.transitionOut} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, transitionOut: e.target.value as SceneEdit["creative"]["transitionOut"] } })}>
                                      {TRANSITIONS.map((c) => (
                                        <option key={c} value={c}>
                                          {c === "dip_primary" ? "Dip to brand colour" : label(c)}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <div className="sm:col-span-2">
                                    <Field label="Setting" htmlFor={`set-${i}`}>
                                      <Input id={`set-${i}`} value={s.creative.setting} maxLength={200} onChange={(e) => sceneUpdate(i, { creative: { ...s.creative, setting: e.target.value } })} />
                                    </Field>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <Field label="Text layout" htmlFor={`lay-${i}`}>
                                      <Select id={`lay-${i}`} value={s.overlay.layout} onChange={(e) => sceneUpdate(i, { overlay: { ...s.overlay, layout: e.target.value as SceneEdit["overlay"]["layout"] } })}>
                                        {LAYOUTS.map((c) => (
                                          <option key={c} value={c}>
                                            {label(c)}
                                          </option>
                                        ))}
                                      </Select>
                                    </Field>
                                  </div>
                                  {s.sceneType !== "product_original" ? (
                                    <div className="sm:col-span-2 xl:col-span-4">
                                      <Field label="Video prompt" htmlFor={`pr-${i}`} hint="Sent to the video model. Text and logos are added by the studio, never by the AI.">
                                        <Textarea id={`pr-${i}`} value={s.prompt} maxLength={2000} onChange={(e) => sceneUpdate(i, { prompt: e.target.value })} />
                                      </Field>
                                    </div>
                                  ) : null}
                                  <div className="sm:col-span-2 xl:col-span-4">
                                    <p className="text-[13px] font-semibold">On-screen text</p>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {lines.map((l, k) =>
                                        l.kind === "placeholder" ? (
                                          <button key={k} type="button" onClick={() => go("message")} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-warn px-2 py-1 text-[13px] font-semibold text-warn hover:bg-warn-soft">
                                            <IconAlert size={14} />
                                            {l.text}
                                          </button>
                                        ) : (
                                          <span key={k} lang={lang} className="rounded-md bg-panel-2 px-2 py-1 text-[13px]">
                                            {l.text}
                                          </span>
                                        ),
                                      )}
                                      {lines.length === 0 ? <span className="text-[13px] text-ink-3">No text on this scene</span> : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </>
                ) : null}
              </>
            ) : null}

            {step === "sound" ? (
              <>
                <Section id="music" title="Music">
                  {finishing.musicAssetId ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <audio controls src={`/api/assets/${finishing.musicAssetId}`} className="h-10 max-w-full" />
                      <Button variant="quiet" onClick={() => update({ finishing: { ...finishing, musicAssetId: null } })}>
                        <IconTrash size={16} />
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <Upload purpose="music" label="Add background music" onUploaded={(a) => update({ finishing: { ...finishing, musicAssetId: a.id, audioMode: settings.clipAudio ? "mix" : "music_only" } })} />
                  )}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label={`Music volume · ${finishing.musicVolumeDb} dB`} htmlFor="m-vol">
                      <input id="m-vol" type="range" min={-30} max={6} step={1} value={finishing.musicVolumeDb} onChange={(e) => update({ finishing: { ...finishing, musicVolumeDb: Number(e.target.value) } })} className="h-10 w-full" />
                    </Field>
                    <Field label="Sound mix" htmlFor="m-mode">
                      <Select id="m-mode" value={finishing.audioMode} onChange={(e) => update({ finishing: { ...finishing, audioMode: e.target.value as Finishing["audioMode"] } })}>
                        <option value="music_only">Music only</option>
                        <option value="mix">Music, lowered under scene sound</option>
                        <option value="clip_only">Scene sound only</option>
                      </Select>
                    </Field>
                  </div>
                </Section>
                <Section id="voiceover" title="Voiceover" description="Upload recorded narration, attach it to a scene and set when it starts.">
                  {draft.scenes.length === 0 ? (
                    <p className="text-sm text-ink-2">
                      Build the storyboard first, then attach voiceover to its scenes.{" "}
                      <button type="button" className="font-semibold text-accent-text hover:underline" onClick={() => go("storyboard")}>
                        Go to storyboard
                      </button>
                    </p>
                  ) : (
                    <div className="grid gap-4">
                      {draft.voiceovers.map((vo, i) => {
                        const setVo = (patch: Partial<VoiceoverSegment>) => update({ voiceovers: draft.voiceovers.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                        const info = view.voiceovers.find((x) => x.assetId === vo.assetId);
                        return (
                          <div key={`${vo.assetId}-${i}`} className="grid gap-3 rounded-lg border border-line p-3">
                            <Waveform assetId={vo.assetId} label={`voiceover ${i + 1}`} />
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                                <Input id={`vo-o-${i}`} className="tabular" type="number" min={0} max={30} step={0.1} value={vo.offsetS} onChange={(e) => setVo({ offsetS: Number(e.target.value) })} />
                              </Field>
                              <Field label={`Volume · ${vo.volumeDb} dB`} htmlFor={`vo-v-${i}`}>
                                <input id={`vo-v-${i}`} type="range" min={-20} max={10} step={1} value={vo.volumeDb} onChange={(e) => setVo({ volumeDb: Number(e.target.value) })} className="h-10 w-full" />
                              </Field>
                              <Field label="Fade in / out (s)" htmlFor={`vo-f-${i}`}>
                                <div className="flex gap-2">
                                  <Input id={`vo-f-${i}`} className="tabular" aria-label="Fade in seconds" type="number" min={0} max={3} step={0.1} value={vo.fadeInS} onChange={(e) => setVo({ fadeInS: Number(e.target.value) })} />
                                  <Input aria-label="Fade out seconds" className="tabular" type="number" min={0} max={3} step={0.1} value={vo.fadeOutS} onChange={(e) => setVo({ fadeOutS: Number(e.target.value) })} />
                                </div>
                              </Field>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <Checkbox id={`vo-m-${i}`} checked={vo.muted} onChange={(v) => setVo({ muted: v })} label="Mute" />
                              {info ? (
                                <p className={`text-xs ${info.talentConsent ? "text-ink-3" : "font-semibold text-warn"}`}>
                                  {info.durationS ? `${info.durationS.toFixed(1)}s long · ` : ""}
                                  {info.talentConsent ? "Voice artist consent recorded" : "No voice artist consent — export will be blocked"}
                                </p>
                              ) : null}
                              <Button variant="quiet" size="sm" onClick={() => update({ voiceovers: draft.voiceovers.filter((_, j) => j !== i) })}>
                                <IconTrash size={15} />
                                Remove
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {draft.voiceovers.length < 12 ? <Upload purpose="voiceover" label="Add a voiceover recording" onUploaded={(a) => update({ voiceovers: [...draft.voiceovers, { assetId: a.id, scenePosition: 0, offsetS: 0, volumeDb: 0, fadeInS: 0.1, fadeOutS: 0.2, muted: false }] })} /> : null}
                      <Checkbox id="vo-duck" checked={finishing.duckClipUnderVoice} onChange={(v) => update({ finishing: { ...finishing, duckClipUnderVoice: v } })} label="Also lower AI scene sound while the voice speaks" />
                    </div>
                  )}
                </Section>
              </>
            ) : null}

            {step === "review" ? (
              <>
                <Section id="summary" title="Summary">
                  <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                    {(
                      [
                        ["Product", brief.product.name || "—", "product"],
                        ["Photos", `${brief.product.imageAssetIds.length}`, "product"],
                        ["Confirmed benefits", `${claims.filter((c) => c.confirmed).length} of ${claims.length}`, "message"],
                        ["Call to action", brief.cta[lang] || "—", "message"],
                        ["Format", `${platform.label} · ${settings.lengthS}s · ${settings.resolution}`, "format"],
                        ["Video model", model?.label ?? settings.modelId, "format"],
                        ["Ending", OUTROS.find((o) => o.value === finishing.outroType)?.label ?? finishing.outroType, "format"],
                        ["Scenes", `${draft.scenes.length}`, "storyboard"],
                        ["Sound", [finishing.musicAssetId ? "Music" : null, draft.voiceovers.length ? `${draft.voiceovers.length} voiceover` : null].filter(Boolean).join(" + ") || "None", "sound"],
                      ] as [string, string, StepKey][]
                    ).map(([k, v, s]) => (
                      <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                        <dt className="text-ink-2">{k}</dt>
                        <dd className="min-w-0 truncate text-right">
                          <button type="button" className="font-semibold hover:text-accent-text hover:underline" onClick={() => go(s)}>
                            {v}
                          </button>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Section>
                {check && check.blocking.length ? (
                  <Section id="fix" title={`${check.blocking.length} to fix before generating`}>
                    <ul className="grid gap-2">
                      {check.blocking.map((b, i) => {
                        const s = STEP_OF_CHECK(b.check, b.message);
                        return (
                          <li key={i} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm">
                            <span className="flex min-w-0 gap-2">
                              <IconAlert size={16} className="mt-0.5 shrink-0 text-bad" />
                              {b.message}
                            </span>
                            <button type="button" className="shrink-0 text-[13px] font-semibold text-ink hover:underline" onClick={() => go(s)}>
                              Go to {STEPS.find((x) => x.key === s)!.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </Section>
                ) : null}
                {check && check.warnings.length ? (
                  <Section id="warnings" title="Worth checking">
                    <ul className="grid gap-2 text-sm text-ink-2">
                      {check.warnings.map((b, i) => (
                        <li key={i} className="flex gap-2">
                          <IconInfoDot />
                          {b.message}
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Step navigation */}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
            {idx > 0 ? (
              <Button variant="quiet" onClick={() => go(STEPS[idx - 1]!.key)}>
                <IconArrowLeft size={16} />
                {STEPS[idx - 1]!.label}
              </Button>
            ) : (
              <span />
            )}
            {idx < STEPS.length - 1 ? (
              <Button variant={done[step] ? "primary" : "secondary"} onClick={() => go(STEPS[idx + 1]!.key)}>
                Next: {STEPS[idx + 1]!.label}
                <IconArrowRight size={16} />
              </Button>
            ) : (
              <Button onClick={generate} disabled={busy !== null || !check?.ok || save === "conflict"}>
                <IconPlay size={15} />
                {busy === "generate" ? "Starting…" : `Generate version ${view.version.number}`}
              </Button>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-[8.5rem] lg:self-start" aria-label="Ad summary">
          <div className="grid gap-4 rounded-xl border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold">Summary</h2>
            <SaveState save={save} className="xl:hidden" />
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AspectGlyph aspect={platform.aspect} size={16} />
                {platform.label}
              </p>
              <p className="tabular mt-0.5 text-[13px] text-ink-2">
                {check?.timeline ? `${check.timeline.totalS.toFixed(1)}s of ${settings.lengthS}s` : `${settings.lengthS}s`} · {settings.resolution} · {draft.scenes.length} scenes
              </p>
              {draft.scenes.length ? (
                <ol aria-hidden className="mt-3 flex h-2 gap-[2px]">
                  {draft.scenes.map((s, i) => (
                    <li key={i} className={`rounded-[2px] ${s.sceneType === "product_original" ? "bg-accent" : "bg-line-strong"}`} style={{ flexGrow: s.durationS }} />
                  ))}
                  <li className="rounded-[2px] border border-ink-3" style={{ flexGrow: 3 }} />
                </ol>
              ) : null}
            </div>
            <div className="border-t border-line pt-3">
              <p className="text-xs font-semibold text-ink-2">Estimated cost</p>
              <p className="tabular text-2xl font-semibold tracking-tight">{usd(check?.estimate?.totalUsd ?? 0)}</p>
              <p className="text-xs text-ink-3">fal.ai list prices — an estimate, not a bill.</p>
            </div>
            {check && check.blocking.length ? (
              <button type="button" onClick={() => go("review")} className="flex items-center justify-between gap-2 rounded-lg bg-bad-soft px-3 py-2 text-left text-[13px] font-semibold text-bad hover:ring-1 hover:ring-bad/40">
                {check.blocking.length} thing{check.blocking.length === 1 ? "" : "s"} to fix
                <IconArrowRight size={15} />
              </button>
            ) : check?.ok ? (
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ok">
                <IconCheck size={15} /> Ready to generate
              </p>
            ) : null}
            <Button className="lg:hidden" onClick={generate} disabled={busy !== null || !check?.ok || save === "conflict"}>
              <IconPlay size={15} />
              {busy === "generate" ? "Starting…" : `Generate version ${view.version.number}`}
            </Button>
            {error ? (
              <p role="alert" className="whitespace-pre-line text-[13px] font-semibold text-bad">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function IconInfoDot() {
  return <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warn" />;
}

function SaveState({ save, className = "" }: { save: SaveState; className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-xs font-medium text-ink-2 ${className}`} aria-live="polite">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${save === "saved" ? "bg-ok" : save === "conflict" || save === "error" ? "bg-bad" : "saving-dot bg-warn"}`} />
      {{ saved: "All changes saved", saving: "Saving…", dirty: "Saving soon…", conflict: "Changed in another tab — reload the page", error: "Couldn't save — check your connection" }[save]}
    </p>
  );
}

function EditorSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Loading the editor" className="mx-auto mt-4 grid max-w-7xl animate-pulse gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="grid gap-4">
        <div className="h-10 rounded-lg bg-panel" />
        <div className="h-48 rounded-xl bg-panel" />
        <div className="h-32 rounded-xl bg-panel" />
      </div>
      <div className="h-64 rounded-xl bg-panel" />
    </div>
  );
}
