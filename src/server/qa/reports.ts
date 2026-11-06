import "../guard";
import { db, tx } from "../db";
import { newId, now, AppError } from "../util";
import type { QaItem } from "./checks/compliance";
import { getBrief } from "../db/repos/versions";
import { indiaToday } from "../brief/offers";
import { usedAssets } from "./used-assets";

export type ReportKind = "technical" | "creative";

export interface StoredItem extends QaItem {
  id: string;
  reportKind: ReportKind;
  acknowledgedAt: number | null;
}

/** Replaces the version's report of this kind (re-runs keep history out of the way). */
export function writeReport(versionId: string, kind: ReportKind, items: QaItem[]): string {
  return tx(() => {
    const old = db().prepare("SELECT id FROM qa_reports WHERE version_id = ? AND kind = ?").all(versionId, kind) as { id: string }[];
    for (const o of old) {
      db().prepare("DELETE FROM qa_items WHERE report_id = ?").run(o.id);
      db().prepare("DELETE FROM qa_reports WHERE id = ?").run(o.id);
    }
    const status = items.some((i) => i.status === "fail") ? "failed" : items.some((i) => i.status === "needs_review") ? "needs_review" : "passed";
    const id = newId("qar");
    db().prepare("INSERT INTO qa_reports (id, version_id, kind, status, created_at) VALUES (?, ?, ?, ?, ?)").run(id, versionId, kind, status, now());
    const ins = db().prepare("INSERT INTO qa_items (id, report_id, check_key, method, status, message, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const it of items) ins.run(newId("qai"), id, it.check, it.method, it.status, it.message, it.evidence === undefined ? null : JSON.stringify(it.evidence));
    return id;
  });
}

export function getItems(versionId: string): StoredItem[] {
  return (
    db()
      .prepare(
        `SELECT i.*, r.kind AS report_kind FROM qa_items i JOIN qa_reports r ON r.id = i.report_id
         WHERE r.version_id = ? ORDER BY r.kind, CASE i.status WHEN 'fail' THEN 0 WHEN 'needs_review' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END, i.check_key`,
      )
      .all(versionId) as { id: string; check_key: string; method: QaItem["method"]; status: QaItem["status"]; message: string; evidence_json: string | null; acknowledged_at: number | null; report_kind: ReportKind }[]
  ).map((r) => ({
    id: r.id,
    check: r.check_key,
    method: r.method,
    status: r.status,
    message: r.message,
    evidence: r.evidence_json ? JSON.parse(r.evidence_json) : undefined,
    reportKind: r.report_kind,
    acknowledgedAt: r.acknowledged_at,
  }));
}

export function qaStatus(versionId: string): "none" | "passed" | "needs_review" | "failed" {
  const items = getItems(versionId);
  if (!items.length) return "none";
  if (items.some((i) => i.status === "fail")) return "failed";
  if (items.some((i) => i.status === "needs_review" && !i.acknowledgedAt)) return "needs_review";
  return "passed";
}

export function refreshQaStatus(versionId: string): void {
  db().prepare("UPDATE ad_versions SET qa_status = ?, updated_at = ? WHERE id = ? AND qa_status <> 'approved'").run(qaStatus(versionId), now(), versionId);
}

export function acknowledge(versionId: string, itemId: string): void {
  tx(() => {
    const r = db()
      .prepare(`UPDATE qa_items SET acknowledged_at = ? WHERE id = ? AND status = 'needs_review' AND report_id IN (SELECT id FROM qa_reports WHERE version_id = ?)`)
      .run(now(), itemId, versionId);
    if (r.changes !== 1) throw new AppError("NOT_REVIEWABLE", "Only items that need review can be acknowledged.", 409);
    db().prepare("INSERT INTO attestations (id, version_id, kind, text, at) VALUES (?, ?, 'qa_review', ?, ?)").run(newId("att"), versionId, `Reviewed QA item ${itemId}`, now());
    refreshQaStatus(versionId);
  });
}

export const FINAL_ATTESTATION = "I confirm all claims, prices and offers in this ad are accurate, current and substantiated.";

export function attest(versionId: string): void {
  db().prepare("INSERT INTO attestations (id, version_id, kind, text, at) VALUES (?, ?, 'compliance_final', ?, ?)").run(newId("att"), versionId, FINAL_ATTESTATION, now());
}

export function hasFinalAttestation(versionId: string): boolean {
  return !!db().prepare("SELECT 1 FROM attestations WHERE version_id = ? AND kind = 'compliance_final'").get(versionId);
}

/** Export gate (plan §9): no fails, all reviews acknowledged, final attestation recorded. */
/**
 * Date-dependent rules re-checked at download time (plan M7, PV2): QA ran when the video was made,
 * but an offer, group deal or licence can expire afterwards. An expired one blocks export.
 */
export function liveExpiryReasons(versionId: string, today = indiaToday(), at = now()): string[] {
  const out: string[] = [];
  const { offers } = getBrief(versionId);
  if (offers.validUntil && offers.validUntil < today) out.push(`The offer ended on ${offers.validUntil}. Make a new version with the current price or offer.`);
  if (offers.groupBuy?.deadline && offers.groupBuy.deadline < today) out.push(`The group deal closed on ${offers.groupBuy.deadline}. Make a new version with a new deadline.`);
  const seen = new Set<string>();
  for (const { asset } of usedAssets(versionId)) {
    if (seen.has(asset.id) || !asset.license_expires_at || asset.license_expires_at >= at) continue;
    seen.add(asset.id);
    out.push(`The licence for ${asset.original_name ?? "an asset in this ad"} expired on ${new Date(asset.license_expires_at).toISOString().slice(0, 10)}.`);
  }
  return out;
}

export function exportGate(versionId: string, today?: string, at?: number): { ok: boolean; reasons: string[]; expired: string[] } {
  const reasons: string[] = [];
  const items = getItems(versionId);
  if (!items.length) reasons.push("QA hasn't run yet.");
  const fails = items.filter((i) => i.status === "fail");
  if (fails.length) reasons.push(`${fails.length} QA check(s) failed.`);
  const open = items.filter((i) => i.status === "needs_review" && !i.acknowledgedAt);
  if (open.length) reasons.push(`${open.length} item(s) still need your review.`);
  if (!hasFinalAttestation(versionId)) reasons.push("Confirm that claims, prices and offers are accurate.");
  const expired = liveExpiryReasons(versionId, today, at);
  reasons.push(...expired);
  return { ok: reasons.length === 0, reasons, expired };
}
