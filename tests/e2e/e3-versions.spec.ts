import { test, expect } from "@playwright/test";
import { buildStoryboard, createAndFillAd, goToStep } from "./helpers";

/** E3: new version from a finished ad with a finishing-only change; both versions stay playable. */
test("new version from a ready ad keeps the old one", async ({ page }) => {
  const adPath = await createAndFillAd(page, "E3 versions");
  await buildStoryboard(page);
  await page.getByRole("button", { name: /Generate version 1/ }).first().click();
  await page.waitForURL(new RegExp(`${adPath}$`));
  await expect(page.getByLabel("Final ad, version 1")).toBeVisible({ timeout: 240_000 });
  const v1Src = await page.getByLabel("Final ad, version 1").getAttribute("src");

  await page.getByRole("button", { name: "New version from this" }).click();
  await page.waitForURL(/\/edit$/);
  await goToStep(page, "Format");
  await page.getByText("Logo and website only").click();
  await expect(page.getByRole("radio", { name: /Minimal/ })).toBeChecked();
  await expect(page.getByText("All changes saved").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: /Generate version 2/ }).first().click();
  await page.waitForURL(new RegExp(`${adPath}$`));
  await expect(page.getByLabel("Final ad, version 2")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText(/reused, \$0/).first()).toBeVisible();
  const v2Src = await page.getByLabel("Final ad, version 2").getAttribute("src");
  expect(v2Src).not.toBe(v1Src);

  await page.getByLabel("Version", { exact: true }).selectOption({ index: 1 }); // newest first → index 1 is v1
  await expect(page.locator(`video[src='${v1Src}']`)).toBeVisible();
  expect((await page.request.get(v1Src!)).status()).toBe(200);
});
