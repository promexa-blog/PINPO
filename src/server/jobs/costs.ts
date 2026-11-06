import "../guard";
import { db } from "../db";
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
