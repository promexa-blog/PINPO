import { defineConfig, devices } from "@playwright/test";
import { computeExecutablePath, Browser } from "@puppeteer/browsers";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * E2E against the PRODUCTION build (`next build` first) with a mock-mode worker and an isolated
 * data home. Uses the pinned chrome-headless-shell, so no extra browser download is needed.
 */
const home = process.env.PINPO_E2E_HOME ?? mkdtempSync(path.join(process.env.PINPO_TEST_TMP ?? tmpdir(), "pinpo-e2e-"));
process.env.PINPO_E2E_HOME = home;
const chrome = computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId: "157.0.8103.38", cacheDir: path.resolve(".cache/chrome") });

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", launchOptions: { executablePath: chrome }, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 800 }, isMobile: false }, testMatch: /e1-.*\.spec\.ts/ },
  ],
  webServer: {
    command: "npx concurrently -k -n web,worker \"npx next start -H 127.0.0.1 -p 3100\" \"node --import tsx src/worker/index.ts\"",
    url: "http://127.0.0.1:3100/api/system/status",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PINPO_HOME: home, FAL_MOCK: "1", MOCK_QUEUE_MS: "600", MOCK_RUN_MS: "900", FAL_POLL_MS: "250", NODE_ENV: "production" },
  },
});
