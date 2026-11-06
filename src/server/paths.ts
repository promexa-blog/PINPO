import "./guard";
import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";

/**
 * Runtime data root (database, backups, media). Defaults to ~/.pinpo — OUTSIDE the project,
 * because Next's dev bundler (Turbopack) watches everything under the project root and SQLite/
 * media writes there caused endless Fast Refresh reloads (Phase 9 finding). Override with
 * PINPO_HOME (tests point it at a temp directory).
 */
export const ROOT = path.resolve(process.env.PINPO_HOME ?? path.join(os.homedir(), ".pinpo"));
/** Read-only bundled assets (fonts, brand, templates) always come from the source tree. */
export const SOURCE_ROOT = path.resolve(process.env.PINPO_SOURCE_ROOT ?? process.cwd());

export const paths = {
  root: ROOT,
  data: path.join(ROOT, "data"),
  db: path.join(ROOT, "data", "studio.db"),
  backups: path.join(ROOT, "data", "backups"),
  logs: path.join(ROOT, "data", "logs"),
  storage: path.join(ROOT, "storage"),
  assets: path.join(ROOT, "storage", "assets"),
  cache: path.join(ROOT, "storage", "cache"),
  work: path.join(ROOT, "storage", "work"),
  chromeCache: path.join(SOURCE_ROOT, ".cache", "chrome"),
  bundled: {
    fonts: path.join(SOURCE_ROOT, "assets", "fonts"),
    brand: path.join(SOURCE_ROOT, "assets", "brand"),
    templates: path.join(SOURCE_ROOT, "assets", "templates"),
  },
} as const;

export function ensureDirs(): void {
  for (const dir of [paths.data, paths.backups, paths.logs, paths.assets, paths.cache, paths.work]) {
    mkdirSync(dir, { recursive: true });
  }
}
