import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { db } from "@/server/db";

const startWorker = () =>
  spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], { env: { ...process.env, FAL_MOCK: "1" }, stdio: ["ignore", "pipe", "pipe"] });

const waitFor = (child: ChildProcess, text: string, ms = 45_000) =>
  new Promise<string>((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${text}". Output:\n${buf}`)), ms);
    const on = (d: Buffer) => {
      buf += d.toString();
      if (buf.includes(text)) {
        clearTimeout(t);
        resolve(buf);
      }
    };
    child.stdout?.on("data", on);
    child.stderr?.on("data", on);
  });

const exitCode = (child: ChildProcess) => new Promise<number | null>((r) => child.on("exit", (c) => r(c)));

describe("worker process", () => {
  it("starts, seeds the protected brand, refuses a second instance (I8), and shuts down cleanly", async () => {
    const first = startWorker();
    const startLog = await waitFor(first, "worker started");
    expect(startLog).toContain("renderer ready");
    const kit = db().prepare("SELECT is_master, locked FROM brand_kits").get() as { is_master: number; locked: number };
    expect(kit).toEqual({ is_master: 1, locked: 1 });
    const logo = db().prepare("SELECT official, temporary, commercial_use FROM assets WHERE source_type = 'official_brand'").get();
    expect(logo).toEqual({ official: 1, temporary: 1, commercial_use: "yes" });

    const second = startWorker();
    await waitFor(second, "another worker is already running");
    expect(await exitCode(second)).toBe(3);

    const firstExit = exitCode(first);
    first.kill("SIGTERM");
    expect(await firstExit).toBe(0);
    const w = db().prepare("SELECT stopped_at, browser_pid FROM workers").get() as { stopped_at: number | null; browser_pid: number | null };
    expect(w.stopped_at).not.toBeNull();
    expect(w.browser_pid).toBeNull();
  });
});
