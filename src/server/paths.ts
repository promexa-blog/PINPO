import "./guard";
import path from "node:path";
import { mkdirSync } from "node:fs";

/** Project root. Tests point PINPO_HOME at a temp directory to isolate data + storage. */
export const ROOT = path.resolve(process.env.PINPO_HOME ?? process.cwd());
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
