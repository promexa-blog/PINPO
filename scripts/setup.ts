/**
 * One-time setup: installs the pinned chrome-headless-shell used by the brand renderer
 * (plan §1 [v2.2]) into .cache/chrome and creates data/storage folders.
 */
import { install, Browser, computeExecutablePath } from "@puppeteer/browsers";
import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { paths, ensureDirs } from "../src/server/paths";
import { PINNED_CHROME_BUILD } from "../src/server/render/browser";

async function main() {
  ensureDirs();
  const exe = computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId: PINNED_CHROME_BUILD, cacheDir: paths.chromeCache });
  if (existsSync(exe)) {
    console.log(`✓ chrome-headless-shell ${PINNED_CHROME_BUILD} already installed`);
  } else {
    console.log(`Installing chrome-headless-shell ${PINNED_CHROME_BUILD} …`);
    await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId: PINNED_CHROME_BUILD, cacheDir: paths.chromeCache });
    console.log(`✓ installed to ${exe}`);
  }
  const envLocal = path.join(paths.root, ".env.local");
  if (!existsSync(envLocal)) {
    copyFileSync(path.join(paths.root, ".env.example"), envLocal);
    console.log("✓ created .env.local from .env.example (mock mode on; add FAL_KEY for real generation)");
  }
  console.log("Setup complete. Start the studio with: npm run dev");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
