import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const PRODUCT_PNG = path.resolve("tests/e2e/fixtures/product.png");

/** Waits for the worker to seed the brand (first start). */
export async function waitForStudio(page: Page) {
  await expect
    .poll(async () => ((await (await page.request.get("/api/system/status")).json()) as { brand: { seeded: boolean }; worker: { online: boolean } }).brand.seeded, { timeout: 60_000 })
    .toBe(true);
}

/** Creates an ad through the UI and fills a complete, compliant brief. Returns the ad URL path. */
export async function createAndFillAd(page: Page, name: string) {
  await page.goto("/");
  await waitForStudio(page);
  await page.reload();
  await page.getByLabel("Ad name").fill(name);
  await page.getByRole("button", { name: "Create ad" }).click();
  await page.waitForURL(/\/ads\/ad_[a-f0-9]+\/edit/);
  await page.getByLabel("Product name").fill("Steel Lunch Box");
  await page.getByLabel("How the product looks").fill("A brushed stainless-steel three-tier lunch box with a matte black clip handle");
  await page.getByLabel("Who is it for?").fill("Young office workers in Kochi");
  await page.getByLabel("Add a product photo").setInputFiles(PRODUCT_PNG);
  await page.getByLabel("I have permission to use this image in DemandMesh ads.").check();
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("img", { name: "Product photo" })).toBeVisible();
  for (const text of ["Three separate tiers keep food apart", "Clip handle carries easily"]) {
    await page.getByRole("button", { name: "Add benefit" }).click();
    const n = await page.getByLabel(/^Benefit \d+$/).count();
    await page.getByLabel(`Benefit ${n}`).fill(text);
    await page.getByLabel("This is true for this product.").nth(n - 1).check();
  }
  await page.getByLabel("Selling price (₹)").fill("899");
  await page.getByLabel("MRP (₹)").fill("1299");
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  return new URL(page.url()).pathname.replace(/\/edit$/, "");
}

export async function buildStoryboard(page: Page) {
  await page.getByRole("button", { name: /Build storyboard|Rebuild storyboard/ }).click();
  await expect(page.getByText("1. Hook — product reveal")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();
}
