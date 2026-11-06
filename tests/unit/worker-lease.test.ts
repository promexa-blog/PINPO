import { describe, it, expect } from "vitest";
import { acquireWorkerLease, heartbeat, releaseWorkerLease, WORKER_LEASE_MS } from "@/server/jobs/worker-lease";

describe("single-instance worker lease (I8)", () => {
  it("refuses a second worker while the first is alive, allows takeover after expiry or stop", () => {
    const t = Date.now();
    expect(acquireWorkerLease("A", { falKeyConfigured: false, mockMode: true }, t).ok).toBe(true);
    expect(acquireWorkerLease("B", { falKeyConfigured: false, mockMode: true }, t + 1000).ok).toBe(false);
    expect(acquireWorkerLease("B", { falKeyConfigured: false, mockMode: true }, t + WORKER_LEASE_MS + 1).ok).toBe(true);
    expect(heartbeat("A")).toBe(false);
    releaseWorkerLease("B");
    expect(acquireWorkerLease("C", { falKeyConfigured: false, mockMode: true }).ok).toBe(true);
  });
});
