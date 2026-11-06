import { describe, it, expect } from "vitest";
import { db, migrate, quickCheck } from "@/server/db";

describe("database", () => {
  it("applies migrations once with reliability pragmas", () => {
    const conn = db();
    expect(conn.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(conn.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(conn.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(migrate(conn)).toEqual([]); // already applied
    expect(quickCheck()).toBe(true);
    const tables = (conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ["assets", "brand_kits", "ad_versions", "scenes", "jobs", "job_events", "cost_entries", "qa_items", "claims", "attestations", "workers", "audio_tracks"]) {
      expect(tables).toContain(t);
    }
  });

  it("enforces cost kinds and one-entry-per-request-per-kind", () => {
    const conn = db();
    const ins = conn.prepare("INSERT INTO cost_entries (id, kind, usd, fal_request_id, at) VALUES (?, ?, ?, ?, ?)");
    ins.run("c1", "calculated", 0.5, "req-1", 1);
    expect(() => ins.run("c2", "calculated", 0.5, "req-1", 1)).toThrow(/UNIQUE/);
    expect(() => ins.run("c3", "actual", 0.5, "req-2", 1)).toThrow(/CHECK/);
  });
});
