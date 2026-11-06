import { MODELS } from "@/server/models/registry";
import { db } from "@/server/db";
import { now } from "@/server/util";
import { costTotalsByMonth } from "@/server/jobs/costs";
import { StudioHeader } from "../_components/header";
import { SystemStatusPanel } from "@/components/status/system-status";
import { MaintenanceButtons } from "../_components/maintenance-buttons";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(2)}`;

export default function SettingsPage() {
  const storage = db().prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(bytes),0) AS b FROM assets GROUP BY kind").all() as { kind: string; n: number; b: number }[];
  const months = costTotalsByMonth();
  const at = now();
  const stale = (iso: string) => at - Date.parse(iso) > 30 * 86_400_000;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8">
      <StudioHeader />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Settings</h1>

      <section aria-labelledby="sys-h" className="mt-6">
        <h2 id="sys-h" className="text-lg font-bold">Studio status</h2>
        <SystemStatusPanel />
        <p className="mt-2 text-sm text-dm-secondary">The fal.ai key and mock mode are set in <code>.env.local</code> (FAL_KEY, FAL_MOCK) and read only by the worker.</p>
      </section>

      <section aria-labelledby="st-h" className="mt-8 grid gap-3">
        <h2 id="st-h" className="text-lg font-bold">Storage</h2>
        <ul className="grid gap-1 text-sm">
          {storage.map((s) => (
            <li key={s.kind}>
              {s.kind}: {s.n} files, {(s.b / 1024 ** 2).toFixed(1)} MB
            </li>
          ))}
        </ul>
        <p className="text-sm text-dm-secondary">Deleted ads are kept for 7 days. Unused files are removed after 24 hours. The cache is capped at 5 GB. A database backup is made daily in data/backups (the last 7 are kept).</p>
        <MaintenanceButtons />
      </section>

      <section aria-labelledby="cost-h" className="mt-8 grid gap-3">
        <h2 id="cost-h" className="text-lg font-bold">Spend by month</h2>
        <table className="w-full max-w-xl text-left text-sm">
          <thead>
            <tr className="border-b border-dm-border">
              <th className="py-2">Month</th>
              <th>Estimated</th>
              <th>Calculated</th>
              <th>Possible extra</th>
              <th>Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b border-dm-border">
                <td className="py-2">{m.month}</td>
                <td>{usd(m.estimated)}</td>
                <td>{usd(m.calculated)}</td>
                <td>{usd(m.exposure)}</td>
                <td>{m.confirmed === null ? "—" : usd(m.confirmed)}</td>
              </tr>
            ))}
            {months.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2 text-dm-secondary">
                  No spend yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="text-xs text-dm-secondary">Estimated and calculated use fal list prices — not billing data. Check your fal dashboard for real charges and enter them on each ad.</p>
      </section>

      <section aria-labelledby="models-h" className="mt-8 grid gap-3">
        <h2 id="models-h" className="text-lg font-bold">Video models</h2>
        <ul className="grid gap-2 text-sm">
          {Object.values(MODELS).map((m) => (
            <li key={m.id} className="rounded-lg border border-dm-border px-3 py-2">
              <span className="font-semibold">{m.label}</span> — {m.summary}
              <br />
              <span className={`text-xs ${stale(m.verifiedAt) ? "font-semibold" : "text-dm-secondary"}`}>
                Checked against fal on {m.verifiedAt}
                {stale(m.verifiedAt) ? " — over 30 days ago; run npm run models:check" : ""}
                {m.retiresAt ? ` · fal retires it on ${m.retiresAt}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
