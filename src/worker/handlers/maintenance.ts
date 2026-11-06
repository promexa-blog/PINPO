import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { backup } from "@/server/db";
import { paths } from "@/server/paths";
import { collectGarbage } from "@/server/storage/gc";
import type { JobHandler } from "../types";

/** Housekeeping jobs: daily DB backup and stale work-dir cleanup. GC of assets arrives with versions (Phase 8). */
export const maintenanceHandler: JobHandler = {
  type: "maintenance",
  concurrency: () => 1,
  async run(ctx) {
    const input = JSON.parse(ctx.job.input_json) as { task?: string };
    const result: Record<string, unknown> = {};
    if (input.task === "backup" || input.task === "all") {
      result.backup = backup();
    }
    if (input.task === "gc" || input.task === "all") {
      result.gc = await collectGarbage();
    }
    if (input.task === "clean_work" || input.task === "all") {
      result.removed = await cleanStaleWork(6 * 60 * 60 * 1000);
    }
    ctx.transition({ status: "succeeded", stage: "done", message: `maintenance ${input.task ?? "noop"} done`, resultJson: result });
  },
};

export async function cleanStaleWork(olderThanMs: number): Promise<number> {
  let removed = 0;
  const cutoff = Date.now() - olderThanMs;
  for (const entry of await readdir(paths.work).catch(() => [])) {
    const full = path.join(paths.work, entry);
    const s = await stat(full).catch(() => null);
    if (s && s.mtimeMs < cutoff) {
      await rm(full, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
