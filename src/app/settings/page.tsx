import { MODELS } from "@/server/models/registry";
import { db } from "@/server/db";
import { now } from "@/server/util";
import { costTotalsByMonth } from "@/server/jobs/costs";
import { SystemStatusPanel } from "@/components/status/system-status";
import { MaintenanceButtons } from "../_components/maintenance-buttons";
import { PageTitle, Section, Status } from "../_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const usd = (n: number) => `$${n.toFixed(2)}`;
const KIND_LABEL: Record<string, string> = { image: "Images", audio: "Audio", video: "Video", font: "Fonts", document: "Other" };

export default function SettingsPage() {
  const storage = db().prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(bytes),0) AS b FROM assets GROUP BY kind ORDER BY b DESC").all() as { kind: string; n: number; b: number }[];
  const months = costTotalsByMonth();
  const at = now();
  const stale = (iso: string) => at - Date.parse(iso) > 30 * 86_400_000;
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
      <PageTitle title="Settings" description="How the studio is running, what it stores and what it has spent." />
      <div className="grid gap-5">
        <Section
          title="Studio status"
          description={
            <>
              The fal.ai key and mock mode live in <code className="rounded bg-panel-2 px-1 py-0.5 text-[12px]">.env.local</code> (FAL_KEY, FAL_MOCK) and are read only by the background worker.
            </>
          }
        >
          <SystemStatusPanel />
        </Section>

        <Section title="Spend by month" description="Estimated and calculated use fal.ai list prices — not billing data. Check your fal.ai dashboard for real charges and enter them on each ad.">
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-3">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Month
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Estimated
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Calculated
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Possible extra
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Confirmed
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pr-3 font-semibold">
                      {m.month}
                    </th>
                    <td className="py-2 pr-3 text-right">{usd(m.estimated)}</td>
                    <td className="py-2 pr-3 text-right">{usd(m.calculated)}</td>
                    <td className="py-2 pr-3 text-right">{usd(m.exposure)}</td>
                    <td className="py-2 text-right">{m.confirmed === null ? "—" : usd(m.confirmed)}</td>
                  </tr>
                ))}
                {months.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-ink-2">
                      Nothing spent yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Storage" description="Deleted ads are kept for 7 days. Unused files are removed after 24 hours. The cache is capped at 5 GB. The database is backed up daily (the last 7 are kept).">
          <ul className="tabular mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {storage.map((s) => (
              <li key={s.kind} className="rounded-lg border border-line px-3 py-2">
                <p className="text-xs text-ink-3">{KIND_LABEL[s.kind] ?? s.kind}</p>
                <p className="font-semibold">{(s.b / 1024 ** 2).toFixed(1)} MB</p>
                <p className="text-xs text-ink-3">{s.n} files</p>
              </li>
            ))}
          </ul>
          <MaintenanceButtons />
        </Section>

        <Section title="Video models" description="Prices and limits were checked against fal.ai on the dates shown. Run npm run models:check to re-check.">
          <ul className="divide-y divide-line">
            {Object.values(MODELS).map((m) => (
              <li key={m.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{m.label}</span>
                  {stale(m.verifiedAt) ? <Status tone="warn">Check due</Status> : null}
                  {m.retiresAt ? <Status tone="bad">Retires {m.retiresAt}</Status> : null}
                </div>
                <p className="text-[13px] text-ink-2">{m.summary}</p>
                <p className="tabular text-xs text-ink-3">Checked {m.verifiedAt}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
