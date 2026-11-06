import "../guard";
import { db, tx } from "../db";
import { newId, now } from "../util";

/** Cost ledger (plan §10 [v2.2]): one row per fal request attempt and kind; never double counted. */

export type CostKind = "estimated" | "calculated" | "exposure_failed" | "exposure_canceled" | "exposure_duplicate" | "confirmed_provider" | "confirmed_manual";

export interface CostEntryInput {
  kind: CostKind;
  usd: number;
  versionId: string;
  jobId?: string | null;
  sceneId?: string | null;
  attempt?: number | null;
  falRequestId?: string | null;
  mock?: boolean;
  possibleDuplicate?: boolean;
  pricingVersion?: string | null;
  basis?: unknown;
  note?: string | null;
}

export function addCost(e: CostEntryInput): void {
  // Plan §10: mock attempts cost nothing. Estimates keep list prices so mock runs show what a real one would cost.
  if (e.mock && e.kind !== "estimated") e = { ...e, usd: 0 };
  db()
    .prepare(
      `INSERT INTO cost_entries (id, version_id, job_id, scene_id, kind, usd, attempt, fal_request_id, mock, possible_duplicate, pricing_version, basis_json, note, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fal_request_id, kind) DO NOTHING`,
    )
    .run(
      newId("cst"), e.versionId, e.jobId ?? null, e.sceneId ?? null, e.kind, e.usd, e.attempt ?? null, e.falRequestId ?? null,
      e.mock ? 1 : 0, e.possibleDuplicate ? 1 : 0, e.pricingVersion ?? null, e.basis === undefined ? null : JSON.stringify(e.basis), e.note ?? null, now(),
    );
}

export interface CostSummary {
  estimated: number;
  calculated: number;
  exposure: { failed: number; canceled: number; duplicate: number; total: number };
  confirmed: number | null;
  mock: boolean;
  entries: { kind: CostKind; usd: number; sceneId: string | null; attempt: number | null; falRequestId: string | null; possibleDuplicate: boolean; reconciled: boolean; note: string | null; at: number }[];
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Totals by category — calculated/exposure are never presented as billed (plan §10). */
export function costSummary(versionId: string): CostSummary {
  const rows = db().prepare("SELECT * FROM cost_entries WHERE version_id = ? ORDER BY at").all(versionId) as {
    kind: CostKind;
    usd: number;
    scene_id: string | null;
    attempt: number | null;
    fal_request_id: string | null;
    possible_duplicate: number;
    reconciled: number;
    mock: number;
    note: string | null;
    at: number;
  }[];
  const sum = (k: CostKind) => r4(rows.filter((r) => r.kind === k && !r.reconciled).reduce((a, r) => a + r.usd, 0));
  const confirmedRows = rows.filter((r) => r.kind === "confirmed_provider" || r.kind === "confirmed_manual");
  const failed = sum("exposure_failed");
  const canceled = sum("exposure_canceled");
  const duplicate = sum("exposure_duplicate");
  return {
    estimated: sum("estimated"),
    calculated: sum("calculated"),
    exposure: { failed, canceled, duplicate, total: r4(failed + canceled + duplicate) },
    confirmed: confirmedRows.length ? r4(confirmedRows.reduce((a, r) => a + r.usd, 0)) : null,
    mock: rows.some((r) => r.mock === 1),
    entries: rows.map((r) => ({ kind: r.kind, usd: r.usd, sceneId: r.scene_id, attempt: r.attempt, falRequestId: r.fal_request_id, possibleDuplicate: !!r.possible_duplicate, reconciled: !!r.reconciled, note: r.note, at: r.at })),
  };
}

/** Plan §10: once confirmed data exists for a request, its calculated/exposure rows are reconciled. */
export function reconcile(falRequestId: string): void {
  db().prepare("UPDATE cost_entries SET reconciled = 1 WHERE fal_request_id = ? AND kind IN ('calculated','exposure_failed','exposure_canceled','exposure_duplicate')").run(falRequestId);
}

/**
 * Manually confirmed amount from the fal dashboard (plan §10, C2/C7). One per version: a new
 * confirmation replaces the previous one, and the version's calculated/exposure rows are marked
 * reconciled so totals use the confirmed figure instead of adding both.
 */
export function confirmManual(versionId: string, usd: number, note: string): void {
  tx(() => {
    db().prepare("DELETE FROM cost_entries WHERE version_id = ? AND kind = 'confirmed_manual'").run(versionId);
    addCost({ kind: "confirmed_manual", usd, versionId, note });
    db().prepare("UPDATE cost_entries SET reconciled = 1 WHERE version_id = ? AND kind IN ('calculated','exposure_failed','exposure_canceled','exposure_duplicate')").run(versionId);
  });
}

/** Deleting a version keeps its spend history: rows are detached, not deleted (monthly totals stay true). */
export function detachVersionCosts(versionId: string): void {
  db().prepare("UPDATE cost_entries SET version_id = NULL, job_id = NULL, scene_id = NULL, note = TRIM(COALESCE(note, '') || ' (version deleted)') WHERE version_id = ?").run(versionId);
}

/** Monthly totals for Settings (plan §10): categories kept separate, never summed into "billed". */
export function costTotalsByMonth(): { month: string; estimated: number; calculated: number; exposure: number; confirmed: number | null }[] {
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%m', at / 1000, 'unixepoch') AS month, kind, SUM(usd) AS usd, COUNT(*) AS n
       FROM cost_entries WHERE reconciled = 0 GROUP BY month, kind ORDER BY month DESC`,
    )
    .all() as { month: string; kind: CostKind; usd: number }[];
  const by = new Map<string, { month: string; estimated: number; calculated: number; exposure: number; confirmed: number | null }>();
  for (const r of rows) {
    const m = by.get(r.month) ?? { month: r.month, estimated: 0, calculated: 0, exposure: 0, confirmed: null };
    if (r.kind === "estimated") m.estimated += r.usd;
    else if (r.kind === "calculated") m.calculated += r.usd;
    else if (r.kind.startsWith("exposure_")) m.exposure += r.usd;
    else m.confirmed = (m.confirmed ?? 0) + r.usd;
    by.set(r.month, m);
  }
  return [...by.values()];
}
