import { expect, test, type Page } from "@playwright/test";

import { assign, employee, freeTables, seat, setEmployeeActive, startShift } from "./support/db";

const tile = (page: Page, label: string) => page.locator(`button[aria-label^='${label},']`).first();

async function enter(page: Page, number: string) {
  await page.goto("/waiter");
  await page.fill("#employee-number", number);
  await page.click("button:has-text('Show my tables')");
}

test.describe.serial("waiter section", () => {
  test.beforeAll(async () => {
    await startShift();
    const kafi = await employee("01", "Kafi", "waiter");
    const musfika = await employee("02", "Musfika", "waiter");
    const off = await employee("04", "Luis", "waiter");
    await setEmployeeActive(off, "Luis", false);
    await assign("X-1", "waiter", kafi);
    await assign("B", "waiter", musfika);
    await seat(["X2"], 4);
    await seat(["B3"], 3);
    await seat(["BAR-1"], 1);
    await freeTables(["X3"]);
  });

  test("unknown and turned-off numbers are refused", async ({ page }) => {
    await enter(page, "777");
    await expect(page.locator("#employee-number-error")).toContainText("No employee has number 777");
    await enter(page, "4");
    await expect(page.locator("#employee-number-error")).toContainText("Luis (04) is turned off");
  });

  test("the number pad finds 01 from 1 and shows the waiter's section first, then the Bar", async ({ page }) => {
    await page.goto("/waiter");
    await page.click("[aria-label='Number pad'] button:text-is('1')");
    await page.click("button:has-text('Show my tables')");
    await expect(page).toHaveURL(/\/waiter\/01$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kafi (01)");
    await expect(page.locator("main")).toContainText("Your section: X(1)");
    await expect(tile(page, "X2")).toContainText("4 guests");
    await expect(page.locator("#group-BAR")).toBeVisible();
  });

  test("own table and the Bar open directly; another waiter's table asks first", async ({ page }) => {
    await page.goto("/waiter/01");
    await tile(page, "X2").click();
    await expect(page).toHaveURL(/\/tables\/X2$/);
    await page.goto("/waiter/01");
    await tile(page, "Bar 1").click();
    await expect(page).toHaveURL(/\/tables\/BAR-1$/);

    await page.goto("/waiter/01");
    await page.click("summary:has-text('Other sections')");
    await tile(page, "B3").click();
    await expect(page.locator("dialog[open] p")).toHaveText("This table is assigned to Musfika (02). Do you want to continue?");
    await page.click("dialog[open] a:has-text('Continue')");
    await expect(page).toHaveURL(/\/tables\/B3\?continue=1$/);
    await expect(page.locator("main")).toContainText("You confirmed opening a table outside your section");
  });

  test("an empty table can't be opened", async ({ page }) => {
    await page.goto("/waiter/01");
    await tile(page, "X3").click();
    await expect(page.locator("main p[role=alert]")).toContainText("No guests are seated at X3");
  });
});
