import { expect, test } from "@playwright/test";

import { employee, startShift } from "./support/db";

test.describe.serial("shifts, employees, and assignments", () => {
  const number = String(900000 + Math.floor(Math.random() * 99999));

  test.beforeAll(async () => {
    await startShift();
  });

  test("a manager adds an employee; the same number can't be used twice", async ({ page }) => {
    await page.goto("/manage/employees");
    await page.fill("input[name=number]", number);
    await page.fill("input[name=name]", "Test Waiter");
    await page.selectOption("#new-role", "waiter");
    await page.click("form button:has-text('Add')");
    await expect(page.getByText(`Test Waiter (${number}) added.`)).toBeVisible();

    await page.fill("input[name=number]", number);
    await page.fill("input[name=name]", "Someone Else");
    await page.click("form button:has-text('Add')");
    await expect(page.locator("main p[role=alert]")).toContainText("already used by Test Waiter");
  });

  test("assigning a waiter shows on the board and on the floor; the latest assignment wins", async ({ page }) => {
    const kafi = await employee("01", "Kafi", "waiter");
    await employee("02", "Musfika", "waiter");
    await page.goto("/manage");
    await page.selectOption("select[aria-label='Waiter for A']", String(kafi));
    await expect(page.getByText("Assignment saved.")).toBeVisible();
    await page.goto("/floor");
    await expect(page.locator("main")).toContainText("Kafi (01)");

    await page.goto("/manage");
    await page.selectOption("select[aria-label='Waiter for B']", String(kafi));
    await expect(page.getByText("Assignment saved.")).toBeVisible();
    await page.goto("/waiter/01");
    await expect(page.locator("main")).toContainText("Your sections: A, B");
  });

  test("the Bar takes no waiter (any waiter can bill it)", async ({ page }) => {
    await page.goto("/manage");
    await expect(page.getByText("Any waiter can bill the Bar")).toBeVisible();
  });
});
