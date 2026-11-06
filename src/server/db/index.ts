import "../guard";
import Database from "better-sqlite3";
import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { paths, ensureDirs, SOURCE_ROOT } from "../paths";

export type DB = Database.Database;

// Resolved from the source tree (not import.meta.url) because Next bundles server code into .next/.
const MIGRATIONS_DIR = path.join(SOURCE_ROOT, "src", "server", "db", "migrations");

let instance: DB | null = null;

/** Opens (once per process) the shared SQLite database with the reliability pragmas from plan §3. */
export function db(): DB {
  if (instance) return instance;
  ensureDirs();
  const conn = new Database(paths.db);
  configure(conn);
  migrate(conn);
  instance = conn;
  return conn;
}

export function configure(conn: DB): void {
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
}

export function migrate(conn: DB): number[] {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const applied = new Set(
    conn.prepare("SELECT version FROM schema_migrations").all().map((r) => (r as { version: number }).version),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const ran: number[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(version, file, Date.now());
    })();
    ran.push(version);
  }
  return ran;
}

/** Runs `fn` in a BEGIN IMMEDIATE transaction (takes the write lock up front → no upgrade deadlocks). */
export function tx<T>(fn: () => T): T {
  return db().transaction(fn).immediate();
}

export function quickCheck(conn: DB = db()): boolean {
  const row = conn.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;
  return row?.quick_check === "ok";
}

/** Daily snapshot via VACUUM INTO; keeps the newest `keep` files. */
export function backup(keep = 7, conn: DB = db()): string | null {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const target = path.join(paths.backups, `studio-${day}.db`);
  if (existsSync(target)) return null;
  conn.prepare("VACUUM INTO ?").run(target);
  const files = readdirSync(paths.backups).filter((f) => /^studio-\d{8}\.db$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(path.join(paths.backups, old), { force: true });
  }
  return target;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

export function getSetting(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
