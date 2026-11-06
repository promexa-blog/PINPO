/**
 * One-time setup: installs the pinned chrome-headless-shell used by the brand renderer
 * (plan §1 [v2.2]) into .cache/chrome and creates data/storage folders.
 */
import { install, Browser, computeExecutablePath } from "@puppeteer/browsers";
import { existsSync, copyFileSync, renameSync, readdirSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
import { paths, ensureDirs, SOURCE_ROOT } from "../src/server/paths";
import { PINNED_CHROME_BUILD } from "../src/server/render/browser";

/** Moves runtime data from the old in-project location (./data, ./storage) to PINPO_HOME once. */
function migrateLegacyData() {
  for (const dir of ["data", "storage"]) {
    const from = path.join(SOURCE_ROOT, dir);
    const to = path.join(paths.root, dir);
    if (!existsSync(from) || path.resolve(from) === path.resolve(to)) continue;
    if (existsSync(to) && readdirSync(to).length) {
      console.log(`! ${from} exists but ${to} already has data — leaving both untouched. Move it manually if needed.`);
      continue;
    }
    try {
      renameSync(from, to);
    } catch {
      cpSync(from, to, { recursive: true });
      rmSync(from, { recursive: true, force: true });
    }
    console.log(`✓ moved ${dir}/ to ${to}`);
  }
}

async function main() {
  migrateLegacyData();
  ensureDirs();
  console.log(`Studio data lives in ${paths.root} (set PINPO_HOME to change it).`);
  const exe = computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId: PINNED_CHROME_BUILD, cacheDir: paths.chromeCache });
  if (existsSync(exe)) {
    console.log(`✓ chrome-headless-shell ${PINNED_CHROME_BUILD} already installed`);
  } else {
    console.log(`Installing chrome-headless-shell ${PINNED_CHROME_BUILD} …`);
    await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId: PINNED_CHROME_BUILD, cacheDir: paths.chromeCache });
    console.log(`✓ installed to ${exe}`);
  }
  const envLocal = path.join(SOURCE_ROOT, ".env.local");
  if (!existsSync(envLocal)) {
    copyFileSync(path.join(SOURCE_ROOT, ".env.example"), envLocal);
    console.log("✓ created .env.local from .env.example (mock mode on; add FAL_KEY for real generation)");
  }
  console.log("Setup complete. Start the studio with: npm run dev");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
