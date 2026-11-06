import "../guard";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { copyFile, truncate, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { paths } from "../paths";
import { ffmpeg } from "../media/run";
import { sha256 } from "../util";
import { ProviderError, type CancelOutcome, type ProviderStatus, type VideoProvider } from "./provider";

/**
 * Local stand-in for fal (FAL_MOCK=1): real MP4s from ffmpeg test sources, simulated queue,
 * state on disk so it survives worker crashes, and fault injection for tests (plan §5):
 * prompt markers like [[mock:fail2]] [[mock:policy]] [[mock:corrupt]] [[mock:short]] [[mock:dupe]]
 * or MOCK_FAULTS='{"failTimes":1}'.
 */

interface MockRequest {
  id: string;
  endpoint: string;
  input: Record<string, unknown>;
  createdAt: number;
  faults: Faults;
  failThisAttempt: boolean;
  canceled: boolean;
}

interface Faults {
  failTimes: number;
  policy: boolean;
  corrupt: boolean;
  short: boolean;
}

const dir = () => path.join(paths.data, "mock-fal");
const reqFile = (id: string) => path.join(dir(), `${id}.json`);
const QUEUE_MS = () => Number(process.env.MOCK_QUEUE_MS ?? 1200);
const RUN_MS = () => Number(process.env.MOCK_RUN_MS ?? 1800);

function parseFaults(prompt: string): Faults {
  const env = (() => {
    try {
      return JSON.parse(process.env.MOCK_FAULTS ?? "{}") as Partial<Faults>;
    } catch {
      return {};
    }
  })();
  const fail = /\[\[mock:fail(\d)\]\]/.exec(prompt);
  return {
    failTimes: fail ? Number(fail[1]) : env.failTimes ?? 0,
    policy: /\[\[mock:policy\]\]/.test(prompt) || !!env.policy,
    corrupt: /\[\[mock:corrupt\]\]/.test(prompt) || !!env.corrupt,
    short: /\[\[mock:short\]\]/.test(prompt) || !!env.short,
  };
}

/** Per-prompt attempt counter so "fail N times then succeed" works across retries/restarts. */
function bumpAttempt(key: string): number {
  const f = path.join(dir(), "attempts.json");
  const all = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, number>) : {};
  all[key] = (all[key] ?? 0) + 1;
  writeFileSync(f, JSON.stringify(all));
  return all[key]!;
}

const HEIGHT: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080, "480P": 480, "768P": 768, "1080P": 1080 };

export class MockProvider implements VideoProvider {
  readonly name = "mock" as const;

  constructor() {
    mkdirSync(dir(), { recursive: true });
  }

  async uploadImage(data: Buffer): Promise<string> {
    const sha = sha256(data);
    const f = path.join(dir(), `upload-${sha}.png`);
    if (!existsSync(f)) writeFileSync(f, data);
    return `https://mock.fal.local/uploads/${sha}.png`;
  }

  async submit(endpoint: string, input: Record<string, unknown>): Promise<string> {
    const prompt = String(input.prompt ?? "");
    const faults = parseFaults(prompt);
    if (faults.policy) throw new ProviderError("content_policy", "fal rejected this prompt or image under its content policy. (mock)", 422);
    const attempt = bumpAttempt(sha256(`${endpoint}|${prompt}`));
    const id = `mock-${randomUUID()}`;
    const req: MockRequest = { id, endpoint, input, createdAt: Date.now(), faults, failThisAttempt: attempt <= faults.failTimes, canceled: false };
    writeFileSync(reqFile(id), JSON.stringify(req));
    return id;
  }

  private load(id: string): MockRequest {
    if (!existsSync(reqFile(id))) throw new ProviderError("not_found", "mock request not found", 404);
    return JSON.parse(readFileSync(reqFile(id), "utf8")) as MockRequest;
  }

  async status(_endpoint: string, requestId: string): Promise<ProviderStatus> {
    const r = this.load(requestId);
    const age = Date.now() - r.createdAt;
    if (r.canceled && age < QUEUE_MS()) return { state: "COMPLETED", error: "Request was cancelled", errorType: "cancelled" };
    if (age < QUEUE_MS()) return { state: "IN_QUEUE", queuePosition: 1 };
    if (age < QUEUE_MS() + RUN_MS()) return { state: "IN_PROGRESS" };
    if (r.failThisAttempt) return { state: "COMPLETED", error: "Mock runner failure", errorType: "runner_failure" };
    return { state: "COMPLETED", error: null };
  }

  async resultVideoUrl(endpoint: string, requestId: string): Promise<string> {
    const r = this.load(requestId);
    const out = path.join(dir(), `${requestId}.mp4`);
    if (!existsSync(out)) await this.render(r, out);
    return pathToFileURL(out).href;
  }

  private async render(r: MockRequest, out: string): Promise<void> {
    const i = r.input;
    const h = HEIGHT[String(i.resolution ?? "720p")] ?? 720;
    const aspect = String(i.aspect_ratio ?? "9:16");
    const [aw, ah] = aspect === "16:9" ? [16, 9] : aspect === "1:1" ? [1, 1] : [9, 16];
    // `resolution` names the short side.
    const short = h;
    const W = Math.round((aw >= ah ? (short * aw) / ah : short) / 2) * 2;
    const H = Math.round((aw >= ah ? short : (short * ah) / aw) / 2) * 2;
    const dur = Number(i.duration ?? 5) * (r.faults.short ? 0.5 : 1);
    const hue = parseInt(sha256(String(i.prompt)).slice(0, 2), 16);
    const args = ["-y", "-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:r=24:d=${dur},hue=h=${hue}`];
    const audio = i.audio === true;
    if (audio) args.push("-f", "lavfi", "-i", `sine=f=${200 + hue}:d=${dur}`);
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac", "-shortest"] : []), out);
    await ffmpeg(args);
    if (r.faults.corrupt) {
      const { size } = await stat(out);
      await truncate(out, Math.floor(size * 0.4));
    }
  }

  async cancel(_endpoint: string, requestId: string, lastKnown: ProviderStatus["state"] | null): Promise<CancelOutcome> {
    const r = this.load(requestId);
    const s = await this.status(_endpoint, requestId);
    if (s.state === "COMPLETED") return "already_completed";
    r.canceled = true;
    writeFileSync(reqFile(requestId), JSON.stringify(r));
    return lastKnown === "IN_QUEUE" || s.state === "IN_QUEUE" ? "removed" : "requested";
  }

  async download(url: string, dest: string): Promise<void> {
    if (!url.startsWith("file:")) throw new ProviderError("not_found", "mock can only download its own files", 404);
    await copyFile(fileURLToPath(url), dest);
  }

  async findRequests(endpoint: string, fromMs: number, toMs: number): Promise<string[] | null> {
    if (/\[\[mock:nolookup\]\]/.test(process.env.MOCK_FAULTS ?? "")) return null;
    return readdirSync(dir())
      .filter((f) => f.startsWith("mock-") && f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(dir(), f), "utf8")) as MockRequest)
      .filter((r) => r.endpoint === endpoint && r.createdAt >= fromMs && r.createdAt <= toMs)
      .map((r) => r.id);
  }
}
