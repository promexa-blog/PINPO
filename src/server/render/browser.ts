import "../guard";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer-core";
import { Browser as BrowserName, computeExecutablePath } from "@puppeteer/browsers";
import sharp from "sharp";
import { paths } from "../paths";
import { newId, AppError } from "../util";
import { fontFaceCss, FONTS, type Lang, missingGlyphs } from "./fonts";

/** Pinned in Phase 0 (docs/engineering/PHASE_0_FINDINGS.md). `npm run setup` installs it. */
export const PINNED_CHROME_BUILD = "157.0.8103.38";
const SYSTEM_CHROME = "/usr/bin/google-chrome";
const RENDER_TIMEOUT_MS = 15_000;
const RECYCLE_AFTER = 200;

export const LAUNCH_ARGS = [
  "--force-device-scale-factor=1",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
  "--allow-file-access-from-files",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
];

export interface ChromeInfo {
  executable: string;
  pinned: boolean;
  build: string;
}

export function resolveChrome(): ChromeInfo {
  const pinnedPath = computeExecutablePath({
    browser: BrowserName.CHROMEHEADLESSSHELL,
    buildId: PINNED_CHROME_BUILD,
    cacheDir: paths.chromeCache,
  });
  if (existsSync(pinnedPath)) return { executable: pinnedPath, pinned: true, build: PINNED_CHROME_BUILD };
  if (process.env.PINPO_CHROME && existsSync(process.env.PINPO_CHROME)) return { executable: process.env.PINPO_CHROME, pinned: false, build: "custom" };
  if (existsSync(SYSTEM_CHROME)) return { executable: SYSTEM_CHROME, pinned: false, build: "system" };
  throw new AppError("RENDERER_MISSING", "No Chrome found. Run `npm run setup` to install the pinned renderer.", 500);
}

export interface FontNeed {
  lang: Lang;
  weight: number;
  text: string;
}

export interface RenderRequest {
  /** Complete <body> inner HTML. Must come from renderToStaticMarkup (escaped text nodes only). */
  bodyHtml: string;
  css: string;
  width: number;
  height: number;
  transparent?: boolean;
  fonts: FontNeed[];
  outFile: string;
}

/** Finds src=/href=/url(...) references that aren't file: or data: (plan §1 [v2.2] network isolation). */
export function findRemoteReference(css: string, html: string): string | null {
  const isLocal = (u: string) => /^(file:|data:)/i.test(u.trim());
  const cssRefs = /(?:url\(\s*["']?|@import\s+["'])([^"')\s]+)/gi;
  for (const m of css.matchAll(cssRefs)) if (!isLocal(m[1]!)) return m[1]!;
  // Only real tags are inspected; escaped user text (&lt;img …&gt;) is not markup.
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    for (const m of tag[0].matchAll(/\b(?:src|href|srcset|poster|xlink:href)\s*=\s*["']?([^"'\s>]+)/gi)) if (!isLocal(m[1]!)) return m[1]!;
    for (const m of tag[0].matchAll(cssRefs)) if (!isLocal(m[1]!)) return m[1]!;
  }
  return null;
}

class Renderer {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private renders = 0;
  info: ChromeInfo | null = null;
  version: string | null = null;

  get pid(): number | null {
    return this.browser?.process()?.pid ?? null;
  }

  private async launch(): Promise<Browser> {
    this.info = resolveChrome();
    const userDataDir = path.join(paths.work, `chrome-profile-${process.pid}`);
    await mkdir(userDataDir, { recursive: true });
    const browser = await puppeteer.launch({
      executablePath: this.info.executable,
      headless: true,
      args: LAUNCH_ARGS,
      userDataDir,
      protocolTimeout: RENDER_TIMEOUT_MS * 2,
    });
    browser.on("disconnected", () => {
      if (this.browser === browser) this.browser = null;
    });
    this.version = await browser.version();
    this.renders = 0;
    return browser;
  }

  async ensure(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.launching ??= this.launch().finally(() => (this.launching = null));
    this.browser = await this.launching;
    return this.browser;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (!b) return;
    try {
      await b.close();
    } catch {
      b.process()?.kill("SIGKILL");
    }
  }

  async kill(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    b?.process()?.kill("SIGKILL");
  }

  /** Renders once; on crash/timeout relaunches and retries exactly once (plan §1 [v2.2]). */
  async render(req: RenderRequest): Promise<{ width: number; height: number }> {
    try {
      return await this.renderOnce(req);
    } catch (err) {
      if (err instanceof AppError && err.code !== "RENDERER_CRASH") throw err;
      await this.kill();
      try {
        return await this.renderOnce(req);
      } catch (err2) {
        if (err2 instanceof AppError && err2.code !== "RENDERER_CRASH") throw err2;
        await this.kill();
        throw new AppError("RENDERER_CRASH", `Renderer failed twice: ${(err2 as Error).message}`, 500);
      }
    }
  }

  private async renderOnce(req: RenderRequest): Promise<{ width: number; height: number }> {
    // 0. Static guard: templates may only reference local file:// or data: URLs.
    const remote = findRemoteReference(req.css, req.bodyHtml);
    if (remote) throw new AppError("RENDER_NETWORK_BLOCKED", `Blocked non-local resource: ${remote}`, 422);
    // 1. Glyph coverage before spending a render (catches tofu).
    for (const need of req.fonts) {
      const missing = missingGlyphs(need.text, need.lang);
      if (missing.length) throw new AppError("GLYPH_MISSING", `Font cannot draw: ${missing.join(" ")} (${need.lang})`, 422);
    }
    if (this.renders >= RECYCLE_AFTER) await this.close();
    const browser = await this.ensure();
    this.renders++;

    // 2. Write the document to the work dir and open it by file:// URL (Phase 0: about:blank can't load file:// fonts).
    await mkdir(paths.work, { recursive: true });
    const htmlFile = path.join(paths.work, `render-${newId("r")}.html`);
    const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; font-src file:; style-src 'unsafe-inline'">
<style>${fontFaceCss()}
*,*::before,*::after{animation:none!important;transition:none!important;box-sizing:border-box}
html,body{margin:0;padding:0;width:${req.width}px;height:${req.height}px;overflow:hidden;background:${req.transparent ? "transparent" : "#FFFFFF"}}
${req.css}</style></head><body>${req.bodyHtml}</body></html>`;
    await writeFile(htmlFile, doc, "utf8");

    const page = await browser.newPage();
    const allowedRoots = [paths.assets, paths.bundled.fonts, paths.bundled.brand, paths.work, paths.cache].map((p) => pathToFileURL(p).href);
    const blocked: string[] = [];
    const work = (async () => {
      await page.setJavaScriptEnabled(true); // only our evaluate() calls run; documents contain no scripts
      await page.setViewport({ width: req.width, height: req.height, deviceScaleFactor: 1 });
      await page.setOfflineMode(true);
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        const url = r.url();
        if (url.startsWith("data:") || allowedRoots.some((root) => url.startsWith(root))) void r.continue();
        else {
          blocked.push(url);
          void r.abort("blockedbyclient");
        }
      });
      // The document CSP stops remote references before they become requests; record those violations too.
      await page.evaluateOnNewDocument(() => {
        const w = window as unknown as { __cspViolations: string[] };
        w.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (e) => w.__cspViolations.push(e.blockedURI || e.violatedDirective));
      });
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      blocked.push(...(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)));
      if (blocked.length) throw new AppError("RENDER_NETWORK_BLOCKED", `Blocked non-local resource: ${blocked[0]}`, 422);

      // 3. Every face actually needed must be loaded — never a silent fallback.
      const checks = req.fonts.map((f) => ({ spec: `${f.weight} 40px`, text: f.text, lang: f.lang }));
      const familiesByLang: Record<Lang, string[]> = {
        en: [FONTS.latin.family],
        ml: [FONTS.malayalam.family, FONTS.latin.family],
        hi: [FONTS.devanagari.family, FONTS.latin.family],
      };
      const result = await page.evaluate(
        async (items, fams) => {
          const failures: string[] = [];
          for (const it of items) {
            const primary = fams[it.lang as "en" | "ml" | "hi"][0]!;
            const font = `${it.spec} "${primary}"`;
            try {
              await document.fonts.load(font, it.text);
            } catch {
              /* reported below */
            }
            if (!document.fonts.check(font, it.text)) failures.push(font);
          }
          await document.fonts.ready;
          return failures;
        },
        checks,
        familiesByLang,
      );
      if (result.length) throw new AppError("FONT_NOT_LOADED", `Fonts not loaded: ${result.join(", ")}`, 500);

      await page.screenshot({
        path: req.outFile as `${string}.png`,
        type: "png",
        omitBackground: !!req.transparent,
        clip: { x: 0, y: 0, width: req.width, height: req.height },
      });
    })();

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new AppError("RENDERER_CRASH", "Render timed out", 500)), RENDER_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("RENDERER_CRASH", (err as Error).message, 500);
    } finally {
      clearTimeout(timer);
      await page.close().catch(() => undefined);
      await rm(htmlFile, { force: true });
    }

    // 4. Deterministic dimensions are asserted, not assumed.
    const meta = await sharp(req.outFile).metadata();
    if (meta.width !== req.width || meta.height !== req.height) {
      throw new AppError("RENDER_SIZE_MISMATCH", `Rendered ${meta.width}×${meta.height}, expected ${req.width}×${req.height}`, 500);
    }
    return { width: req.width, height: req.height };
  }
}

export const renderer = new Renderer();
