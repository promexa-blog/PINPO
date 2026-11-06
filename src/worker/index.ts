import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, quickCheck, closeDb } from "@/server/db";
import { paths, ensureDirs } from "@/server/paths";
import { enqueue, releaseAll } from "@/server/jobs/queue";
import { acquireWorkerLease, heartbeat, releaseWorkerLease, getWorker, WORKER_HEARTBEAT_MS } from "@/server/jobs/worker-lease";
import { seedMasterBrand } from "@/server/brand/master";
import { seedTemplates } from "@/server/planning/templates";
import { renderer } from "@/server/render/browser";
import { createScheduler } from "./loop";
import { maintenanceHandler } from "./handlers/maintenance";
import { sceneGenerateHandler } from "./handlers/scene-generate";
import { composeHandler } from "./handlers/compose";
import { smokeTestRenderer } from "./smoke";
import type { JobHandler } from "./types";

// The worker is the ONLY process that reads FAL_KEY (plan §1). Next never needs it.
for (const file of [".env.local", ".env"]) {
  const p = path.join(paths.root, file);
  if (existsSync(p)) process.loadEnvFile(p);
}

const instanceId = randomUUID();
const log = (msg: string, data?: unknown) => {
  // Never log env or secrets; data objects are built by us.
  console.log(JSON.stringify({ at: new Date().toISOString(), worker: instanceId.slice(0, 8), msg, ...(data ? { data } : {}) }));
};

const handlers: JobHandler[] = [sceneGenerateHandler, composeHandler, maintenanceHandler];

async function killOrphanBrowser(): Promise<void> {
  const prev = getWorker();
  if (!prev?.browser_pid) return;
  try {
    process.kill(prev.browser_pid, "SIGKILL");
    log("killed orphaned Chrome from previous worker", { pid: prev.browser_pid });
  } catch {
    /* already gone */
  }
}

async function wipeWorkDir(): Promise<void> {
  await mkdir(paths.work, { recursive: true });
  for (const entry of await readdir(paths.work)) await rm(path.join(paths.work, entry), { recursive: true, force: true });
}

async function main(): Promise<void> {
  ensureDirs();
  db();
  if (!quickCheck()) {
    log("database quick_check FAILED — restore from data/backups/ before continuing");
    process.exit(2);
  }
  const mockMode = process.env.FAL_MOCK === "1";
  const falKeyConfigured = !!process.env.FAL_KEY?.trim();
  await killOrphanBrowser();
  const lease = acquireWorkerLease(instanceId, { falKeyConfigured, mockMode });
  if (!lease.ok) {
    log("another worker is already running — exiting", { pid: lease.holder.pid });
    process.exit(3);
  }
  await wipeWorkDir();
  await seedMasterBrand();
  seedTemplates();
  const day = new Date().toISOString().slice(0, 10);
  enqueue({ type: "maintenance", idempotencyKey: `maintenance:backup:${day}`, input: { task: "backup" }, priority: 200 });
  enqueue({ type: "maintenance", idempotencyKey: `maintenance:gc:${day}`, input: { task: "gc" }, priority: 210 });

  let rendererVersion: string | null = null;
  try {
    rendererVersion = await smokeTestRenderer();
    log("renderer ready", { version: rendererVersion, pinned: renderer.info?.pinned });
  } catch (err) {
    log("renderer smoke test failed — rendering jobs will fail until fixed (run `npm run setup`)", { error: String(err) });
  }
  heartbeat(instanceId, { rendererVersion, browserPid: renderer.pid });
  log("worker started", { mockMode, falKeyConfigured, handlers: handlers.map((h) => h.type) });

  const scheduler = createScheduler(instanceId, handlers, log);
  const tick = setInterval(() => {
    try {
      scheduler.tick();
    } catch (err) {
      log("scheduler tick failed", { error: String(err) });
    }
  }, 1000);
  const beat = setInterval(() => {
    if (!heartbeat(instanceId, { browserPid: renderer.pid })) {
      log("worker lease lost — another worker took over; exiting");
      void shutdown(4);
    }
  }, WORKER_HEARTBEAT_MS);

  let shuttingDown = false;
  async function shutdown(code = 0): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    // Hard stop: leases are released in the DB either way, and expire in 60s if this never runs.
    setTimeout(() => process.exit(code || 1), 45_000).unref();
    log("shutting down");
    clearInterval(tick);
    clearInterval(beat);
    await scheduler.stop(5_000); // jobs resume from their stored stage, so no long grace is needed
    const released = releaseAll(instanceId);
    await renderer.close();
    releaseWorkerLease(instanceId);
    closeDb();
    log("stopped", { released });
    process.exit(code);
  }
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}

main().catch((err) => {
  log("worker failed to start", { error: String(err) });
  process.exit(1);
});
