"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VersionView } from "@/server/views";
import { PLATFORMS } from "@/lib/platforms";
import { Button, Checkbox, Section, Status, api, usd } from "./ui";

const ACTIVE = new Set(["queued", "generating", "composing"]);
const STAGE_LABEL: Record<string, string> = {
  preparing: "Preparing",
  submitting: "Sending to fal",
  in_queue: "Waiting in queue",
  in_progress: "Generating",
  downloading: "Downloading",
  validating: "Checking clip",
  done: "Done",
  normalizing: "Preparing clips",
  rendering_overlays: "Adding brand graphics",
  encoding: "Encoding",
  finalizing: "Running QA",
};
const CHECK_LABEL: Record<string, string> = {
  logo_accuracy: "Logo",
  brand_color_compliance: "Brand colours",
  product_appearance: "Product appearance",
  text_readability: "Text readability",
  hook_effectiveness: "Opening hook",
  cta_presence: "Call to action",
  end_card_correctness: "Outro",
  product_claim_accuracy: "Claims",
  offer_accuracy: "Price and offer",
  platform_safe_placement: "Safe placement",
  asset_rights: "Rights",
  fabricated_testimonial: "Testimonials",
};

export function Overview({ versionId }: { versionId: string }) {
  const [view, setView] = useState<VersionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const etag = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/versions/${versionId}`, { headers: etag.current ? { "If-None-Match": etag.current } : {} });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`Couldn't load this ad (${res.status})`);
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

  if (!view) return <p className="py-10 text-sm text-dm-secondary">{error ?? "Loading…"}</p>;
  const v = view.version;
  const p = PLATFORMS[v.platform];
  const running = ACTIVE.has(v.status);
  const review = view.qa.filter((q) => q.status === "needs_review");
  const fails = view.qa.filter((q) => q.status === "fail");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-6">
        <Section
          title={`Version ${v.number}`}
          description={`${p.label} · ${p.aspect} · ${view.settings.lengthS}s · ${view.settings.resolution}`}
          actions={running ? <Button variant="danger" disabled={busy} onClick={() => act(() => api(`/api/versions/${versionId}/cancel`, { method: "POST" }))}>Cancel</Button> : null}
        >
          {v.status === "ready" && v.finalAssetId ? (
            <video controls preload="metadata" poster={v.thumbAssetId ? `/api/assets/${v.thumbAssetId}` : undefined} src={`/api/assets/${v.finalAssetId}`} className={`mx-auto max-h-[70dvh] rounded-lg bg-dm-surface ${p.aspect === "9:16" ? "aspect-[9/16]" : p.aspect === "1:1" ? "aspect-square" : "aspect-video w-full"}`} />
          ) : (
            <div className="grid gap-3" aria-live="polite">
              <p className="text-sm font-semibold">
                {v.status === "failed" ? `Something went wrong: ${v.errorMessage ?? "see the scenes below"}` : v.status === "canceled" ? "Canceled." : v.status === "composing" ? "All scenes are ready — putting the ad together." : "Generating scenes…"}
              </p>
              {view.composeJob && view.composeJob.status === "running" ? (
                <div className="h-2 overflow-hidden rounded-full bg-dm-secondary-light" role="progressbar" aria-valuenow={Math.round((view.composeJob.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Composing">
                  <div className="h-full bg-dm-primary transition-[width]" style={{ width: `${Math.round((view.composeJob.progress ?? 0) * 100)}%` }} />
                </div>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Scenes">
          <ol className="grid gap-3 sm:grid-cols-2">
            {view.scenes.map((s, i) => (
              <li key={s.id} className="rounded-lg border border-dm-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">
                    {i + 1}. {s.label}
                  </p>
                  <Status tone={s.status === "succeeded" ? "ok" : s.status === "failed" ? "bad" : "neutral"}>{s.status === "succeeded" ? "Ready" : s.status === "failed" ? "Failed" : s.job ? STAGE_LABEL[s.job.stage] ?? s.job.stage : "Waiting"}</Status>
                </div>
                <p className="mt-1 text-xs text-dm-secondary">
                  {s.durationS.toFixed(1)}s · {s.sceneType === "product_original" ? "original product photo" : "AI video"}
                  {s.job && s.job.attempt > 1 ? ` · attempt ${s.job.attempt} of ${s.job.max_attempts}` : ""}
                  {s.job?.queue_position ? ` · queue position ${s.job.queue_position}` : ""}
                </p>
                {s.clipAssetId ? <video muted playsInline controls preload="none" src={`/api/assets/${s.clipAssetId}`} className="mt-2 max-h-48 rounded bg-dm-surface" /> : null}
                {s.job?.error_message && s.status !== "succeeded" ? <p className="mt-2 text-xs">{s.job.error_message}</p> : null}
                {s.status === "failed" ? (
                  <Button variant="secondary" className="mt-2" disabled={busy} onClick={() => act(() => api(`/api/versions/${versionId}/scenes/${s.id}/retry`, { method: "POST" }))}>
                    Try this scene again
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>

        {view.qa.length ? (
          <Section title="Quality checks" description="Technical checks and DemandMesh brand and advertising rules. Items marked 'Review' need your eyes before export.">
            <ul className="grid gap-2">
              {view.qa
                .filter((q) => q.reportKind === "creative" || q.status !== "pass")
                .map((q) => (
                  <li key={q.id} className="grid gap-2 rounded-lg border border-dm-border p-3 sm:grid-cols-[150px_1fr_auto] sm:items-start">
                    <div className="flex items-center gap-2">
                      <Status tone={q.status === "pass" ? "ok" : q.status === "fail" ? "bad" : q.status === "needs_review" ? "warn" : "neutral"}>
                        {q.status === "pass" ? "Pass" : q.status === "fail" ? "Fail" : q.status === "needs_review" ? (q.acknowledgedAt ? "Reviewed" : "Review") : "Note"}
                      </Status>
                      <span className="text-sm font-semibold">{CHECK_LABEL[q.check] ?? q.check.replace(/^technical_/, "").replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-sm">
                      {q.message}
                      {q.method !== "automated" ? <span className="ml-1 text-xs text-dm-secondary">({q.method === "heuristic" ? "assessment" : "needs a person"})</span> : null}
                    </p>
                    {q.status === "needs_review" && !q.acknowledgedAt ? (
                      <Button variant="secondary" disabled={busy} onClick={() => act(() => api(`/api/versions/${versionId}/qa/${q.id}/ack`, { method: "POST" }))}>
                        I reviewed this
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-xs text-dm-secondary">{view.qa.filter((q) => q.reportKind === "technical" && q.status === "pass").length} technical checks passed (length, size, frame rate, colour, audio, fast start, clean decode).</p>
          </Section>
        ) : null}
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-4">
        <div className="grid gap-3 rounded-xl border border-dm-border bg-dm-surface p-4">
          <p className="text-sm font-bold">Cost</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-dm-secondary">Estimated</dt>
            <dd className="text-right font-semibold">{usd(view.costs.estimated)}</dd>
            <dt className="text-dm-secondary">Calculated</dt>
            <dd className="text-right font-semibold">{usd(view.costs.calculated)}</dd>
            <dt className="text-dm-secondary">Possible extra</dt>
            <dd className="text-right font-semibold">{view.costs.exposure.total ? `up to ${usd(view.costs.exposure.total)}` : usd(0)}</dd>
            <dt className="text-dm-secondary">Confirmed</dt>
            <dd className="text-right font-semibold">{view.costs.confirmed === null ? "—" : usd(view.costs.confirmed)}</dd>
          </dl>
          <p className="text-xs text-dm-secondary">
            {view.costs.mock ? "Mock mode: no real charges. " : ""}Estimated and calculated use fal list prices — they are not billing data. &quot;Possible extra&quot; covers failed or cancelled attempts that fal may still charge for. Check your fal dashboard for the real amount.
          </p>
        </div>

        {v.status === "ready" ? (
          <div className="grid gap-3 rounded-xl border border-dm-border bg-dm-bg p-4">
            <p className="text-sm font-bold">Export</p>
            {fails.length ? <p className="text-sm">Fix the {fails.length} failed check(s) first — usually by editing the brief and making a new version.</p> : null}
            {review.filter((r) => !r.acknowledgedAt).length ? <p className="text-sm">Review {review.filter((r) => !r.acknowledgedAt).length} item(s) in Quality checks.</p> : null}
            <Checkbox id="attest" checked={view.attested} onChange={(val) => (val && !view.attested ? void act(() => api(`/api/versions/${versionId}/attest`, { method: "POST", body: JSON.stringify({ confirm: true }) })) : undefined)} label={view.attestationText} />
            {view.exportGate?.ok ? (
              <a href={`/api/versions/${versionId}/export`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-dm-primary px-4 text-sm font-semibold text-white hover:bg-dm-hover">
                Download MP4 ({p.width}×{p.height})
              </a>
            ) : (
              <Button disabled>Download MP4</Button>
            )}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="whitespace-pre-line text-sm font-semibold">
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
