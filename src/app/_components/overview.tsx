"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VersionView } from "@/server/views";
import { PLATFORMS } from "@/lib/platforms";
import { ASPECT_RATIO } from "./frame";
import { Button, Checkbox, Notice, Section, Status, api, buttonClass, usd, type Tone } from "./ui";
import { IconAlert, IconCheck, IconChevronDown, IconDownload, IconLayout, IconRefresh, IconTrash, IconX } from "./icons";

const ACTIVE = new Set(["queued", "generating", "composing"]);
const STAGE_LABEL: Record<string, string> = {
  preparing: "Preparing",
  submitting: "Sending to fal.ai",
  in_queue: "Waiting in queue",
  in_progress: "Generating",
  downloading: "Downloading",
  validating: "Checking clip",
  done: "Done",
  normalizing: "Preparing clips",
  rendering_overlays: "Adding brand graphics",
  encoding: "Encoding",
  finalizing: "Running checks",
};
const CHECK_LABEL: Record<string, string> = {
  logo_accuracy: "Logo",
  brand_color_compliance: "Brand colours",
  product_appearance: "Product appearance",
  text_readability: "Text readability",
  hook_effectiveness: "Opening hook",
  cta_presence: "Call to action",
  end_card_correctness: "Ending",
  product_claim_accuracy: "Claims",
  offer_accuracy: "Price and offer",
  platform_safe_placement: "Safe placement",
  asset_rights: "Rights",
  fabricated_testimonial: "Testimonials",
};
const VERSION_STATUS: Record<string, string> = { draft: "draft", queued: "queued", generating: "generating", composing: "editing", ready: "ready", failed: "failed", canceled: "canceled" };

type QaItem = VersionView["qa"][number];
const qaTone = (q: QaItem): Tone => (q.status === "pass" ? "ok" : q.status === "fail" ? "bad" : q.status === "needs_review" ? (q.acknowledgedAt ? "ok" : "warn") : "neutral");
const qaLabel = (q: QaItem) => (q.status === "pass" ? "Pass" : q.status === "fail" ? "Fail" : q.status === "needs_review" ? (q.acknowledgedAt ? "Reviewed" : "Review") : "Note");

export function Overview({ versionId, adId }: { versionId: string; adId: string }) {
  const router = useRouter();
  const [view, setView] = useState<VersionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const etag = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/versions/${versionId}`, { headers: etag.current ? { "If-None-Match": etag.current } : {} });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`Couldn't load this ad (${res.status}). Reload the page.`);
    etag.current = res.headers.get("ETag");
    setView((await res.json()) as VersionView);
  }, [versionId]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  // Poll every 2 s while work is running (plan §13); ETag makes unchanged polls cheap.
  useEffect(() => {
    if (!view || !ACTIVE.has(view.version.status)) return;
    const t = setInterval(() => void load().catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [view, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      etag.current = null;
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!view)
    return error ? (
      <div className="mt-6">
        <Notice tone="bad">{error}</Notice>
      </div>
    ) : (
      <div aria-busy="true" aria-label="Loading the ad" className="mt-6 grid animate-pulse gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="h-[60dvh] rounded-xl bg-panel" />
        <div className="h-72 rounded-xl bg-panel" />
      </div>
    );

  const v = view.version;
  const p = PLATFORMS[v.platform];
  const running = ACTIVE.has(v.status);
  const versions = view.versions as { id: string; number: number; status: string }[];
  const scenesDone = view.scenes.filter((s) => s.status === "succeeded" || s.status === "reused").length;
  const creative = view.qa.filter((q) => q.reportKind === "creative" || q.status !== "pass");
  const order = (q: QaItem) => (q.status === "fail" ? 0 : q.status === "needs_review" && !q.acknowledgedAt ? 1 : q.status === "warn" ? 2 : 3);
  const sortedQa = [...creative].sort((a, b) => order(a) - order(b));
  const fails = view.qa.filter((q) => q.status === "fail");
  const toReview = view.qa.filter((q) => q.status === "needs_review" && !q.acknowledgedAt);
  const techPassed = view.qa.filter((q) => q.reportKind === "technical" && q.status === "pass").length;
  const progress = v.status === "composing" ? 0.85 + 0.15 * (view.composeJob?.progress ?? 0) : view.scenes.length ? (scenesDone / view.scenes.length) * 0.85 : 0;

  return (
    <div className="mt-5">
      {/* Version toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <div className="relative">
          <select
            id="version-switch"
            aria-label="Version"
            value={v.id}
            onChange={(e) =>
              void act(async () => {
                await api(`/api/ads/${adId}`, { method: "PATCH", body: JSON.stringify({ currentVersionId: e.target.value }) });
                router.refresh();
              })
            }
            className="min-h-10 appearance-none rounded-lg border border-line bg-sunken pl-3 pr-8 text-sm font-semibold hover:border-line-strong"
          >
            {versions.map((x) => (
              <option key={x.id} value={x.id}>
                Version {x.number} · {VERSION_STATUS[x.status] ?? x.status}
              </option>
            ))}
          </select>
          <IconChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        </div>
        {!running ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await fetch(`/api/versions/${versionId}/fork`, { method: "POST" });
                const body = (await r.json()) as { versionId?: string };
                if (!body.versionId) throw new Error("Couldn't create a new version. Try again.");
                router.push(`/ads/${adId}/edit`);
              })
            }
          >
            <IconRefresh size={16} />
            {v.status === "draft" ? "Edit draft" : "New version from this"}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => {
            const name = window.prompt("Name for the new template", `${view.ad.name} layout`);
            if (name)
              void act(async () => {
                await api(`/api/versions/${versionId}/save-as-template`, { method: "POST", body: JSON.stringify({ name }) });
                window.alert("Saved. It's now in Templates and in the list when you start a new ad.");
              });
          }}
        >
          <IconLayout size={16} />
          Save as template
        </Button>
        {versions.length > 1 && !running ? (
          <Button
            variant="quiet"
            disabled={busy}
            className="ml-auto"
            onClick={() => {
              const other = versions.find((x) => x.id !== v.id);
              if (other && window.confirm(`Delete version ${v.number}?\n\nIts video and check results are removed. Other versions stay.`))
                void act(async () => {
                  await api(`/api/ads/${adId}`, { method: "PATCH", body: JSON.stringify({ currentVersionId: other.id }) });
                  await fetch(`/api/versions/${versionId}`, { method: "DELETE" });
                  router.refresh();
                });
            }}
          >
            <IconTrash size={16} />
            Delete version
          </Button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Player / progress */}
        <section aria-label={`Version ${v.number} video`} className="min-w-0 overflow-hidden rounded-xl lg:col-start-1 border border-line bg-frame">
          <div className={`grid place-items-center p-4 sm:p-6 ${p.aspect === "16:9" ? "" : "min-h-[22rem]"}`}>
            {v.status === "ready" && v.finalAssetId ? (
              <video
                aria-label={`Final ad, version ${v.number}`}
                controls
                preload="metadata"
                poster={v.thumbAssetId ? `/api/assets/${v.thumbAssetId}` : undefined}
                src={`/api/assets/${v.finalAssetId}`}
                className="max-h-[72dvh] max-w-full rounded-md bg-black shadow-lift"
                style={{ aspectRatio: ASPECT_RATIO[p.aspect], ...(p.aspect === "16:9" ? { width: "100%" } : { height: "72dvh" }) }}
              />
            ) : (
              <div className="w-full max-w-md py-10 text-center" aria-live="polite">
                {v.status === "failed" || v.status === "canceled" ? (
                  <>
                    <span className="mx-auto grid size-11 place-items-center rounded-full bg-bad-soft text-bad">{v.status === "failed" ? <IconAlert size={22} /> : <IconX size={22} />}</span>
                    <p className="mt-4 font-semibold">{v.status === "failed" ? "This version didn't finish" : "Canceled"}</p>
                    <p className="mt-1 text-sm text-ink-2">{v.status === "failed" ? v.errorMessage ?? "Retry the failed scenes below, or make a new version." : "Make a new version to try again. Finished scenes are reused for free."}</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{v.status === "composing" ? "Putting the ad together" : v.status === "queued" ? "Waiting to start" : "Generating scenes"}</p>
                    <p className="tabular mt-1 text-sm text-ink-2">
                      {v.status === "composing" ? "Adding text, music and the ending" : `${scenesDone} of ${view.scenes.length} scenes ready`}
                    </p>
                    <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-label="Progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
                    </div>
                    <p className="mt-3 text-xs text-ink-3">You can leave this page — generation keeps running.</p>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-4 py-2.5 text-[13px] text-ink-2">
            <span className="tabular">
              {p.label} · {p.aspect} · {view.settings.lengthS}s · {view.settings.resolution}
            </span>
            {running ? (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => act(() => api(`/api/versions/${versionId}/cancel`, { method: "POST" }))}>
                Cancel generation
              </Button>
            ) : null}
          </div>
        </section>

        <aside className="grid content-start gap-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" aria-label="Export and cost">
          {v.status === "ready" ? (
            <section aria-labelledby="export-h" className="grid gap-3 rounded-xl border border-line bg-panel p-4">
              <h2 id="export-h" className="font-semibold">
                Export
              </h2>
              <ol className="grid gap-2 text-[13px]">
                <GateRow ok={fails.length === 0} label={fails.length ? `Fix ${fails.length} failed check${fails.length === 1 ? "" : "s"} — usually by editing the brief in a new version` : "No failed checks"} />
                <GateRow ok={toReview.length === 0} label={toReview.length ? `Review ${toReview.length} item${toReview.length === 1 ? "" : "s"} in Quality checks` : "Everything reviewed"} />
                <GateRow ok={view.attested} label={view.attested ? "Claims and prices confirmed" : "Confirm claims and prices below"} />
              </ol>
              <div className="rounded-lg border border-line p-3">
                <Checkbox id="attest" checked={view.attested} onChange={(val) => (val && !view.attested ? void act(() => api(`/api/versions/${versionId}/attest`, { method: "POST", body: JSON.stringify({ confirm: true }) })) : undefined)} label={view.attestationText} />
              </div>
              {view.exportGate?.ok ? (
                <a href={`/api/versions/${versionId}/export`} className={buttonClass("primary")}>
                  <IconDownload size={17} />
                  Download MP4 · {p.width}×{p.height}
                </a>
              ) : (
                <button type="button" disabled className={buttonClass("primary")}>
                  <IconDownload size={17} />
                  Download MP4
                </button>
              )}
              <a href={`/api/versions/${versionId}/credits?download=1`} className="text-center text-[13px] font-semibold text-ink-2 hover:text-ink hover:underline">
                Download credits.txt
              </a>
            </section>
          ) : null}

          <section aria-labelledby="cost-h" className="grid gap-3 rounded-xl border border-line bg-panel p-4">
            <h2 id="cost-h" className="font-semibold">
              Cost
            </h2>
            <dl className="tabular grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-2">Estimated</dt>
              <dd className="text-right font-semibold">{usd(view.costs.estimated)}</dd>
              <dt className="text-ink-2">Calculated</dt>
              <dd className="text-right font-semibold">{usd(view.costs.calculated)}</dd>
              <dt className="text-ink-2">Possible extra</dt>
              <dd className="text-right font-semibold">{view.costs.exposure.total ? `up to ${usd(view.costs.exposure.total)}` : usd(0)}</dd>
              <dt className="text-ink-2">Confirmed</dt>
              <dd className="text-right font-semibold">{view.costs.confirmed === null ? "—" : usd(view.costs.confirmed)}</dd>
            </dl>
            <p className="text-xs leading-relaxed text-ink-3">
              {view.costs.mock ? "Mock mode: nothing was charged. " : ""}Estimated and calculated use fal.ai list prices — not billing data. &quot;Possible extra&quot; covers failed or cancelled attempts fal may still charge for. Your fal dashboard has the real amount.
            </p>
          </section>
          {error ? (
            <p role="alert" className="whitespace-pre-line text-[13px] font-semibold text-bad">
              {error}
            </p>
          ) : null}
        </aside>
        <div className="grid min-w-0 content-start gap-6 lg:col-start-1">
          <Section title="Scenes" description={running ? undefined : `${scenesDone} of ${view.scenes.length} ready`}>
            <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(13rem,100%),1fr))] gap-3">
              {view.scenes.map((s, i) => {
                const ok = s.status === "succeeded" || s.status === "reused";
                return (
                  <li key={s.id} className="flex flex-col overflow-hidden rounded-lg border border-line bg-panel-2/40">
                    <div className="flex h-44 items-center justify-center overflow-hidden bg-frame">
                      {s.clipAssetId ? (
                        <video muted playsInline controls preload="metadata" src={`/api/assets/${s.clipAssetId}#t=0.1`} aria-label={`Scene ${i + 1} clip`} className="h-44 w-auto max-w-full bg-black object-contain" style={{ aspectRatio: ASPECT_RATIO[p.aspect] }} />
                      ) : (
                        <span className={`text-xs ${s.status === "failed" ? "text-bad" : "text-ink-3"}`}>{s.status === "failed" ? "Failed" : s.job ? STAGE_LABEL[s.job.stage] ?? s.job.stage : "Waiting"}</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">
                          <span className="tabular text-ink-3">{i + 1}</span> {s.label}
                        </p>
                        <Status tone={ok ? "ok" : s.status === "failed" ? "bad" : "accent"}>{ok ? "Ready" : s.status === "failed" ? "Failed" : s.job ? STAGE_LABEL[s.job.stage] ?? "Working" : "Waiting"}</Status>
                      </div>
                      <p className="tabular text-xs text-ink-3">
                        {s.durationS.toFixed(1)}s · {s.sceneType === "product_original" ? "real product photo" : "AI video"}
                        {s.status === "reused" ? " · reused, $0" : ""}
                        {s.job && s.job.attempt > 1 ? ` · attempt ${s.job.attempt} of ${s.job.max_attempts}` : ""}
                        {s.job?.queue_position ? ` · #${s.job.queue_position} in queue` : ""}
                      </p>
                      {s.job?.error_message && !ok ? <p className="text-xs text-bad">{s.job.error_message}</p> : null}
                      {s.status === "failed" ? (
                        <Button variant="secondary" size="sm" className="mt-1 self-start" disabled={busy} onClick={() => act(() => api(`/api/versions/${versionId}/scenes/${s.id}/retry`, { method: "POST" }))}>
                          Try this scene again
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>

          {view.qa.length ? (
            <Section title="Quality checks" description={`Brand, claim, price, rights and technical checks. Items marked Review need a person to look before export. ${techPassed} technical checks passed (length, size, frame rate, colour, sound, clean decode).`}>
              <ul className="divide-y divide-line">
                {sortedQa.map((q) => (
                  <li key={q.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr_auto] sm:items-start">
                    <div className="flex items-center gap-2">
                      <Status tone={qaTone(q)}>{qaLabel(q)}</Status>
                      <span className="text-sm font-semibold">{CHECK_LABEL[q.check] ?? q.check.replace(/^technical_/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                    </div>
                    <p className="text-sm text-ink-2">
                      {q.message}
                      {q.method !== "automated" ? <span className="ml-1 text-xs text-ink-3">({q.method === "heuristic" ? "assessment" : "needs a person"})</span> : null}
                    </p>
                    {q.status === "needs_review" && !q.acknowledgedAt ? (
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => act(() => api(`/api/versions/${versionId}/qa/${q.id}/ack`, { method: "POST" }))}>
                        <IconCheck size={15} />I reviewed this
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

      </div>
    </div>
  );
}

function GateRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-start gap-2 ${ok ? "text-ink-2" : "font-semibold text-ink"}`}>
      <span aria-hidden className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${ok ? "bg-ok-soft text-ok" : "border border-warn text-warn"}`}>{ok ? <IconCheck size={11} strokeWidth={2.5} /> : null}</span>
      <span>
        <span className="sr-only">{ok ? "Done: " : "To do: "}</span>
        {label}
      </span>
    </li>
  );
}
