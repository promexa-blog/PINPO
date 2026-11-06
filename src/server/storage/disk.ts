import "../guard";
import { statfs } from "node:fs/promises";
import { paths } from "../paths";
import { AppError } from "../util";

export const GB = 1024 ** 3;

/** Overridable in tests to simulate low disk (plan test I13). */
let freeBytesOverride: number | null = null;
export function __setFreeBytesForTests(v: number | null): void {
  freeBytesOverride = v;
}

export async function freeBytes(dir: string = paths.storage): Promise<number> {
  if (freeBytesOverride !== null) return freeBytesOverride;
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

/** Plan §9: require estimated need × 3 + 1 GB free before generating/composing. */
export function requiredBytes(estimatedNeed: number): number {
  return estimatedNeed * 3 + GB;
}

export async function assertDiskSpace(estimatedNeed: number): Promise<void> {
  const free = await freeBytes();
  const need = requiredBytes(estimatedNeed);
  if (free < need) {
    throw new AppError(
      "INSUFFICIENT_STORAGE",
      `Not enough free disk space: ${(free / GB).toFixed(1)} GB free, ${(need / GB).toFixed(1)} GB needed. Free up space in Settings → Storage.`,
      507,
    );
  }
}

export function isDiskFullError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOSPC";
}
