import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { PRODUCT_PNG, waitForStudio } from "./helpers";

/** Several product photos picked at once upload together and all land in the brief. */
test("uploads several product photos in one go", async ({ page }) => {
  await page.goto("/");
  await waitForStudio(page);
  await page.goto("/new");
  await page.getByLabel(/^Name/).fill("E4 multi upload");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/ads\/ad_[a-f0-9]+\/edit/);

  const second = await sharp({ create: { width: 640, height: 640, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toBuffer();
  await page.getByLabel("Add product photos").setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: readFileSync(PRODUCT_PNG) },
    { name: "side.png", mimeType: "image/png", buffer: second },
  ]);
  await expect(page.getByText("2 files selected")).toBeVisible();
  await page.getByLabel("I have permission to use these images in my ads.").check();
  await page.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(page.getByRole("img", { name: "Product photo 1" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Product photo 2" })).toBeVisible();
  await expect(page.getByText("2 photos added.")).toBeVisible();
  await expect(page.getByText("All changes saved").filter({ visible: true })).toBeVisible();

  // Survives a reload (one autosave with both ids, not a lost update).
  await page.reload();
  await expect(page.getByRole("img", { name: /^Product photo \d$/ })).toHaveCount(2);
});
