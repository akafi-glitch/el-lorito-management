import { expect, test, type Page } from "@playwright/test";

import { freeTables, seat } from "./support/db";

const tile = (page: Page, label: string) => page.locator(`main button[aria-label^="${label},"]`).first();

test.describe.serial("floor management", () => {
  test.beforeAll(async () => {
    await freeTables(["A1", "A2", "A3", "A4", "A5", "A6", "B3", "B4", "C1", "P1"]);
  });

  test("all 45 tables are shown with their colors explained", async ({ page }) => {
    await page.goto("/floor");
    await expect(page.locator("main button[aria-label*=', ']").filter({ hasText: /chair|guest|Seats not set/ })).toHaveCount(45);
    for (const label of ["Vacant", "Needs chips", "Chips served", "Section closed"]) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
  });

  test("a suggested table is seated, served chips, and cleared", async ({ page }) => {
    await page.goto("/floor");
    await page.fill("#party-guests", "3");
    await page.click("button:has-text('Find a table')");
    const suggestion = page.locator("ul li").filter({ hasText: "Seat here" }).first();
    await expect(suggestion).toBeVisible();
    const table = (await suggestion.textContent())!.match(/^\s*([A-Z]{1,2}\d{1,2})/)![1]!;
    await suggestion.locator("button:has-text('Seat here')").click();
    await expect(page.getByText(`Seated 3 guests at ${table}.`)).toBeVisible();
    await expect(tile(page, table)).toHaveAttribute("aria-label", /3 guests, Needs chips/);

    await tile(page, table).click();
    await page.click("dialog[open] button:has-text('Chips served')");
    await expect(tile(page, table)).toHaveAttribute("aria-label", /Chips served/);

    await tile(page, table).click();
    await expect(page.locator("dialog[open]")).toContainText("Is the table cleaned?");
    await page.click("dialog[open] button:has-text('No')");
    await expect(tile(page, table)).toHaveAttribute("aria-label", /Chips served/);
    await tile(page, table).click();
    await page.click("dialog[open] button:has-text('Yes, clear table')");
    await expect(tile(page, table)).toHaveAttribute("aria-label", /Vacant/);
  });

  test("a table chosen by hand asks for the guest count; joined tables are seated together", async ({ page }) => {
    await page.goto("/floor");
    await tile(page, "B3").click();
    await tile(page, "B4").click();
    await expect(page.getByText("Join B3 + B4")).toBeVisible();
    await expect(page.locator("#tray-guests")).toHaveValue("");
    await page.fill("#tray-guests", "9");
    await page.click("[aria-label='Seat selected tables'] button[type=submit]");
    await expect(page.getByText("Seated 9 guests at B3 + B4.")).toBeVisible();
    await expect(tile(page, "B3")).toHaveAttribute("aria-label", /9 guests, joined with B4/);
    await expect(tile(page, "B4")).toHaveAttribute("aria-label", /9 guests, joined with B3/);
  });

  test("a large party is offered Party seating first", async ({ page }) => {
    await page.goto("/floor");
    await page.fill("#party-guests", "14");
    await page.click("button:has-text('Find a table')");
    await expect(page.locator("ul li").filter({ hasText: "Seat here" }).first()).toContainText("Party");
  });

  test("a closed section can't be seated until it is opened again", async ({ page }) => {
    await page.goto("/floor");
    await page.click("button[aria-label='Close section C']");
    await expect(tile(page, "C1")).toHaveAttribute("aria-label", /Section closed/);
    await tile(page, "C1").click();
    await page.click("dialog[open] button:has-text('Open section C')");
    await expect(tile(page, "C1")).toHaveAttribute("aria-label", /Vacant/);
  });

  test("a table taken on another device can't be seated twice", async ({ page }) => {
    await page.goto("/floor");
    await expect(tile(page, "A6")).toHaveAttribute("aria-label", /Vacant/);
    await seat(["A6"], 2); // the other device
    await tile(page, "A6").click();
    if (await page.locator("#tray-guests").isVisible()) {
      await page.fill("#tray-guests", "2");
      await page.click("[aria-label='Seat selected tables'] button[type=submit]");
      await expect(page.getByText("A6 was just taken on another device")).toBeVisible();
    }
    // Either way the screen ends up showing A6 taken (live updates may already have shown it).
    await expect(tile(page, "A6")).toHaveAttribute("aria-label", /2 guests/);
  });
});
