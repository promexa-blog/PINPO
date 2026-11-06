import { test, expect } from "@playwright/test";
import { createAndFillAd, goToStep } from "./helpers";

/** E2: autosave, reload, continue — data preserved; A5 conflict across tabs. */
test("autosaves the draft and survives a reload; second tab gets a conflict", async ({ page, context }) => {
  await createAndFillAd(page, "E2 autosave");
  await page.reload(); // stays on the Message step (#message)
  await expect(page.getByLabel("Benefit 2", { exact: true })).toHaveValue("Clip handle carries easily");
  await expect(page.getByLabel("Selling price (₹)")).toHaveValue("899");
  await goToStep(page, "Product");
  await expect(page.getByLabel("Product name")).toHaveValue("Steel Lunch Box");

  const tab2 = await context.newPage();
  await tab2.goto(page.url());
  await expect(tab2.getByLabel("Product name")).toHaveValue("Steel Lunch Box");
  await page.getByLabel("Product name").fill("Steel Lunch Box Pro");
  await expect(page.getByText("All changes saved").filter({ visible: true })).toBeVisible();
  await tab2.getByLabel("Product name").fill("Something else");
  await expect(tab2.getByText(/Changed in another tab/).filter({ visible: true })).toBeVisible();

  // The first tab's save is what persisted; the conflicting edit did not overwrite it.
  await page.reload();
  await goToStep(page, "Product");
  await expect(page.getByLabel("Product name")).toHaveValue("Steel Lunch Box Pro");
});
