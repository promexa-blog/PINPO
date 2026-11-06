import { test, expect } from "@playwright/test";
import { buildStoryboard, createAndFillAd } from "./helpers";

/** E1 / Q5 / M9: brief → storyboard → generate (mock) → QA → attest → export, desktop and 375px. */
test("create, generate, review and export an ad", async ({ page }, info) => {
  const adPath = await createAndFillAd(page, `E1 ${info.project.name}`);
  await buildStoryboard(page);
  const generate = page.getByRole("button", { name: /Generate version 1/ }).first();
  await expect(generate).toBeEnabled();
  await generate.click();
  await page.waitForURL(new RegExp(`${adPath}$`));

  // Progress → finished video.
  await expect(page.getByLabel(/^Final ad, version 1$/)).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("heading", { name: "Quality checks" })).toBeVisible();

  // M9: export blocked until reviews + attestation.
  const exportBtn = page.getByRole("button", { name: "Download MP4" });
  await expect(exportBtn).toBeDisabled();
  const reviews = page.getByRole("button", { name: "I reviewed this" });
  while ((await reviews.count()) > 0) {
    await reviews.first().click();
    await page.waitForTimeout(400);
  }
  const attest = page.getByLabel(/I confirm all claims, prices and offers/);
  await attest.click(); // controlled by server state: ticks once the attestation is saved
  await expect(attest).toBeChecked();
  const link = page.getByRole("link", { name: /Download MP4/ });
  await expect(link).toBeVisible();
  const res = await page.request.get((await link.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("video/mp4");
  expect(res.headers()["content-disposition"]).toMatch(/demandmesh_steel-lunch-box_instagram_reels_1080x1920_v1\.mp4/);
  const credits = await page.request.get(`/api/versions/${(await link.getAttribute("href"))!.split("/")[3]}/credits`);
  expect(await credits.text()).toContain("Credits");

  // No horizontal scroll at this width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
