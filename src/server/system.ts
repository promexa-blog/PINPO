import "./guard";
import { db, quickCheck } from "./db";
import { freeBytes } from "./storage/disk";
import { getWorker, workerOnline } from "./jobs/worker-lease";
import { getMasterBrand } from "./brand/master";
import { PINNED_CHROME_BUILD } from "./render/browser";
import { now } from "./util";

export interface SystemStatus {
  worker: { online: boolean; heartbeatAgeS: number | null; pid: number | null; mockMode: boolean; falKeyConfigured: boolean; rendererVersion: string | null };
  renderer: { pinnedBuild: string; usingPinned: boolean | null };
  disk: { freeBytes: number; storageBytes: number };
  db: { ok: boolean };
  brand: { seeded: boolean; name: string | null; logoTemporary: boolean | null; fontsTemporary: boolean | null };
}

/** Read-only snapshot for GET /api/system/status (no side effects). */
export async function systemStatus(): Promise<SystemStatus> {
  const w = getWorker();
  const brand = getMasterBrand();
  const storage = db().prepare("SELECT COALESCE(SUM(bytes),0) AS b FROM assets").get() as { b: number };
  const rv = w?.renderer_version ?? null;
  return {
    worker: {
      online: workerOnline(w),
      heartbeatAgeS: w ? Math.round((now() - w.heartbeat_at) / 1000) : null,
      pid: w?.pid ?? null,
      mockMode: w?.mock_mode === 1,
      falKeyConfigured: w?.fal_key_configured === 1,
      rendererVersion: rv,
    },
    renderer: { pinnedBuild: PINNED_CHROME_BUILD, usingPinned: rv ? rv.includes(PINNED_CHROME_BUILD) : null },
    disk: { freeBytes: await freeBytes(), storageBytes: storage.b },
    db: { ok: quickCheck() },
    brand: {
      seeded: !!brand,
      name: brand?.name ?? null,
      logoTemporary: brand ? brand.logos.some((l) => l.temporary) : null,
      fontsTemporary: brand ? (brand.tokens.typography as { fontsTemporary?: boolean }).fontsTemporary ?? null : null,
    },
  };
}
