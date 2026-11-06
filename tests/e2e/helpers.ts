import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const PRODUCT_PNG = path.resolve("tests/e2e/fixtures/product.png");

/** Waits for the worker to seed the brand (first start). */
export async function waitForStudio(page: Page) {
  await expect
    .poll(async () => ((await (await page.request.get("/api/system/status")).json()) as { brand: { seeded: boolean }; worker: { online: boolean } }).brand.seeded, { timeout: 60_000 })
    .toBe(true);
}

/** Moves to an editor step using the step rail. */
export async function goToStep(page: Page, label: "Product" | "Message" | "Format" | "Storyboard" | "Sound" | "Generate") {
  // Desktop tabs are named "<Label> …"; the compact phone stepper uses "Step N: <Label>".
  await page.getByRole("button", { name: new RegExp(`^(Step \\d+: )?${label}\\b`) }).first().click();
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
}

/** Creates an ad through the UI (New ad → step flow) and fills a complete, compliant brief. Returns the ad URL path. */
export async function createAndFillAd(page: Page, name: string) {
  await page.goto("/");
  await waitForStudio(page);
  await page.goto("/new");
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/ads\/ad_[a-f0-9]+\/edit/);

  // Step 1 — product
  await page.getByLabel("Product name").fill("Steel Lunch Box");
  await page.getByLabel("How the product looks").fill("A brushed stainless-steel three-tier lunch box with a matte black clip handle");
  await page.getByLabel("Add product photos").setInputFiles(PRODUCT_PNG);
  await page.getByLabel("I have permission to use this image in my ads.").check();
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("img", { name: "Product photo 1" })).toBeVisible();

  // Step 2 — message
  await page.getByRole("button", { name: "Next: Message" }).click();
  await page.getByLabel("Who is it for?").fill("Young office workers in Kochi");
  for (const text of ["Three separate tiers keep food apart", "Clip handle carries easily"]) {
    await page.getByRole("button", { name: "Add benefit" }).click();
    const n = await page.getByLabel(/^Benefit \d+$/).count();
    await page.getByLabel(`Benefit ${n}`, { exact: true }).fill(text);
    await page.getByLabel("This is true for this product.").nth(n - 1).check();
  }
  await page.getByLabel("Selling price (₹)").fill("899");
  await page.getByLabel("MRP (₹)").fill("1299");
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByText("All changes saved").filter({ visible: true })).toBeVisible();
  return new URL(page.url()).pathname.replace(/\/edit$/, "");
}

export async function buildStoryboard(page: Page) {
  await goToStep(page, "Storyboard");
  await page.getByRole("button", { name: /Build storyboard|Rebuild from brief/ }).click();
  await expect(page.getByRole("heading", { name: /Hook — product reveal/ })).toBeVisible();
  await expect(page.getByText("All changes saved").filter({ visible: true })).toBeVisible();
}
