import type { ReactNode } from "react";
import { MODELS } from "@/server/models/registry";
import { db } from "@/server/db";
import { paths } from "@/server/paths";
import { now } from "@/server/util";
import { costTotalsByMonth } from "@/server/jobs/costs";
import { PINNED_CHROME_BUILD } from "@/server/render/browser";
import { getWorker, workerOnline } from "@/server/jobs/worker-lease";
import { SystemStatusPanel } from "@/components/status/system-status";
import { MaintenanceButtons } from "../_components/maintenance-buttons";
import { SettingsNav, type SettingsSection } from "../_components/settings-nav";
import { ThemeSetting } from "../_components/theme-setting";
import { PageTitle, Notice, Status } from "../_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const usd = (n: number) => `$${n.toFixed(2)}`;
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const KIND: Record<string, { label: string; dot: string }> = {
  video: { label: "Videos", dot: "bg-accent" },
  image: { label: "Images", dot: "bg-ink-2" },
  audio: { label: "Audio", dot: "bg-ok" },
  font: { label: "Fonts", dot: "bg-line-strong" },
  document: { label: "Other", dot: "bg-ink-3" },
};

const SECTIONS: SettingsSection[] = [
  { id: "status", label: "Studio status" },
  { id: "generation", label: "Video generation" },
  { id: "spend", label: "Spend" },
  { id: "storage", label: "Storage" },
  { id: "models", label: "Video models" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" },
];

function Block({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid scroll-mt-24 gap-4 border-b border-line pb-10 last:border-0 last:pb-0 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-10">
      <div>
        <h2 id={`${id}-h`} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-2">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[12px] text-ink">{children}</code>;
}

export default function SettingsPage() {
  const storage = db().prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(bytes),0) AS b FROM assets GROUP BY kind ORDER BY b DESC").all() as { kind: string; n: number; b: number }[];
  const totalBytes = storage.reduce((a, s) => a + s.b, 0) || 1;
  const months = costTotalsByMonth();
  const at = now();
  const thisMonth = new Date(at).toISOString().slice(0, 7);
  const month = months.find((m) => m.month === thisMonth);
  const stale = (iso: string) => at - Date.parse(iso) > 30 * 86_400_000;
  const w = getWorker();
  const live = workerOnline(w);
  const mock = w?.mock_mode === 1;

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
      <PageTitle title="Settings" description="How the studio is running, what it stores and what it has spent." />
      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12">
        <SettingsNav sections={SECTIONS} />

        <div className="grid min-w-0 gap-10">
          <Block id="status" title="Studio status" description="Checked every few seconds. Everything should read OK before you generate.">
            <SystemStatusPanel />
          </Block>

          <Block id="generation" title="Video generation" description="Mock mode makes free test clips so you can try the whole flow. Real generation uses your fal.ai account.">
            <div className="grid gap-4 rounded-xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Current mode</p>
                  <p className="mt-0.5 text-[13px] text-ink-2">{!live ? "The worker is offline, so nothing can be generated right now." : mock ? "Test clips — nothing is charged." : "Real AI video from fal.ai — charged to your fal account."}</p>
                </div>
                <Status tone={!live ? "bad" : mock ? "warn" : "ok"}>{!live ? "Worker offline" : mock ? "Mock mode" : "fal.ai live"}</Status>
              </div>
              <div className="border-t border-line pt-4">
                <p className="text-sm font-semibold">{mock ? "Switch to real generation" : "Change mode"}</p>
                <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[13px] text-ink-2 marker:text-ink-3">
                  <li>
                    Open <Code>.env.local</Code> in the project folder.
                  </li>
                  <li>
                    Set <Code>FAL_KEY=</Code> to your key from fal.ai, and <Code>FAL_MOCK=0</Code> {mock ? "" : "(or 1 for test clips)"}.
                  </li>
                  <li>
                    Restart the studio (<Code>npm run dev</Code> or <Code>npm start</Code>).
                  </li>
                </ol>
                <p className="mt-3 text-xs text-ink-3">The key is read only by the background worker and never sent to the browser.</p>
              </div>
            </div>
          </Block>

          <Block id="spend" title="Spend" description="Estimated and calculated amounts use fal.ai list prices — they're not billing data. Your fal.ai dashboard has the real charges; enter them on each ad to mark them confirmed.">
            <div className="overflow-hidden rounded-xl border border-line bg-panel">
              <p className="border-b border-line px-5 py-2.5 text-xs font-semibold text-ink-3">This month · {new Date(at).toLocaleString("en-IN", { month: "long", year: "numeric" })}</p>
              <dl className="tabular grid grid-cols-2 divide-line border-b border-line sm:grid-cols-4 sm:divide-x">
                {(
                  [
                    ["Estimated", month ? usd(month.estimated) : usd(0)],
                    ["Calculated", month ? usd(month.calculated) : usd(0)],
                    ["Possible extra", month ? usd(month.exposure) : usd(0)],
                    ["Confirmed", month?.confirmed != null ? usd(month.confirmed) : "—"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="px-5 py-4">
                    <dt className="text-xs text-ink-3">{k}</dt>
                    <dd className="mt-1 text-lg font-semibold tracking-tight">{v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="tabular divide-y divide-line text-sm sm:hidden" aria-label="Spend by month">
                {months.map((m) => (
                  <li key={m.month} className="grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3">
                    <p className="col-span-2 font-semibold">{new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" })}</p>
                    <span className="text-ink-3">Estimated</span>
                    <span className="text-right">{usd(m.estimated)}</span>
                    <span className="text-ink-3">Calculated</span>
                    <span className="text-right">{usd(m.calculated)}</span>
                    <span className="text-ink-3">Possible extra</span>
                    <span className="text-right">{usd(m.exposure)}</span>
                    <span className="text-ink-3">Confirmed</span>
                    <span className="text-right">{m.confirmed === null ? "—" : usd(m.confirmed)}</span>
                  </li>
                ))}
                {months.length === 0 ? <li className="px-5 py-4 text-ink-2">Nothing spent yet.</li> : null}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="tabular w-full min-w-[34rem] text-left text-sm">
                  <caption className="sr-only">Spend by month</caption>
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-3">
                      <th scope="col" className="px-5 py-2.5 font-semibold">
                        Month
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                        Estimated
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                        Calculated
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                        Possible extra
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                        Confirmed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => (
                      <tr key={m.month} className="border-b border-line last:border-0">
                        <th scope="row" className="px-5 py-2.5 font-semibold">
                          {new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" })}
                        </th>
                        <td className="px-5 py-2.5 text-right">{usd(m.estimated)}</td>
                        <td className="px-5 py-2.5 text-right">{usd(m.calculated)}</td>
                        <td className="px-5 py-2.5 text-right">{usd(m.exposure)}</td>
                        <td className="px-5 py-2.5 text-right">{m.confirmed === null ? "—" : usd(m.confirmed)}</td>
                      </tr>
                    ))}
                    {months.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-4 text-ink-2">
                          Nothing spent yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </Block>

          <Block id="storage" title="Storage" description="Deleted ads are kept for 7 days. Unused files are cleared after 24 hours, the cache is capped at 5 GB, and the database is backed up daily (the last 7 are kept).">
            <div className="grid gap-5 rounded-xl border border-line bg-panel p-5">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">Used by the studio</p>
                  <p className="tabular text-sm text-ink-2">{mb(storage.reduce((a, s) => a + s.b, 0))}</p>
                </div>
                <div className="mt-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-panel-2" aria-hidden>
                  {storage.map((s) => (
                    <div key={s.kind} className={KIND[s.kind]?.dot ?? "bg-ink-3"} style={{ flexGrow: s.b / totalBytes, flexBasis: 0, minWidth: s.b ? 3 : 0 }} />
                  ))}
                </div>
                <ul className="tabular mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                  {storage.map((s) => (
                    <li key={s.kind} className="flex items-center gap-2 whitespace-nowrap">
                      <span aria-hidden className={`size-2 shrink-0 rounded-[2px] ${KIND[s.kind]?.dot ?? "bg-ink-3"}`} />
                      <span className="text-ink-2">{KIND[s.kind]?.label ?? s.kind}</span>
                      <span className="font-semibold">{mb(s.b)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-[13px] text-ink-2">Runs in the background; you can keep working.</p>
                <MaintenanceButtons />
              </div>
            </div>
          </Block>

          <Block id="models" title="Video models" description="The models available for AI scenes. Prices and limits were checked against fal.ai on the dates shown — run npm run models:check to re-check.">
            <ul className="divide-y divide-line rounded-xl border border-line bg-panel sm:hidden" aria-label="Video models">
              {Object.values(MODELS).map((m) => (
                <li key={m.id} className="grid gap-1 px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{m.label}</span>
                    {stale(m.verifiedAt) ? <Status tone="warn">Check due</Status> : null}
                    {m.retiresAt ? <Status tone="bad">Retires {m.retiresAt}</Status> : null}
                  </div>
                  <p className="text-[13px] text-ink-2">{m.summary}</p>
                  <p className="tabular text-xs text-ink-3">Checked {m.verifiedAt}</p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-xl border border-line bg-panel sm:block">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">Video models</caption>
                <thead>
                  <tr className="border-b border-line text-xs text-ink-3">
                    <th scope="col" className="px-5 py-2.5 font-semibold">
                      Model
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">
                      Best for
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                      Checked
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(MODELS).map((m) => (
                    <tr key={m.id} className="border-b border-line align-top last:border-0">
                      <th scope="row" className="whitespace-nowrap px-5 py-3 font-semibold">
                        {m.label}
                      </th>
                      <td className="px-5 py-3 text-[13px] text-ink-2">{m.summary}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="tabular block whitespace-nowrap text-[13px] text-ink-2">{m.verifiedAt}</span>
                        {stale(m.verifiedAt) ? (
                          <span className="mt-1 inline-block">
                            <Status tone="warn">Check due</Status>
                          </span>
                        ) : null}
                        {m.retiresAt ? (
                          <span className="mt-1 inline-block">
                            <Status tone="bad">Retires {m.retiresAt}</Status>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <Block id="appearance" title="Appearance" description="Applies to the studio only. Your ads always use their brand's colours.">
            <ThemeSetting />
          </Block>

          <Block id="about" title="About" description="Where the studio keeps your work on this computer.">
            <div className="grid gap-4 rounded-xl border border-line bg-panel p-5">
              <dl className="grid gap-3 text-sm sm:grid-cols-[11rem_1fr]">
                <dt className="text-ink-2">Version</dt>
                <dd className="tabular font-semibold">PINPO 0.1.0</dd>
                <dt className="text-ink-2">Data folder</dt>
                <dd className="min-w-0 break-all">
                  <Code>{paths.root}</Code>
                </dd>
                <dt className="text-ink-2">Graphics renderer</dt>
                <dd className="tabular">Chrome {PINNED_CHROME_BUILD} (pinned)</dd>
              </dl>
              <Notice>
                Back up the data folder to keep your ads, brands and settings. Set <Code>PINPO_HOME</Code> to store it somewhere else.
              </Notice>
            </div>
          </Block>
        </div>
      </div>
    </main>
  );
}
