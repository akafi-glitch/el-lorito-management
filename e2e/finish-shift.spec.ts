import { expect, test } from "@playwright/test";

import { assign, cancelOpenOrders, employee, finishShift, openTicketsAt, saveOrder, setItem, startShift } from "./support/db";
import { testEnv } from "./support/env";

const shiftButton = (name: string) => `section[aria-labelledby='shift-heading'] button:has-text('${name}')`;
const TABLE = "P5";

test.describe.serial("finishing a shift", () => {
  const env = testEnv();
  let waiter = 0;

  test.beforeAll(async () => {
    waiter = await employee("01", "Kafi", "waiter");
    await setItem("Taco", 235, true);
    await cancelOpenOrders([TABLE]);
    await startShift();
  });

  test("after starting a shift the button is Finish shift, and closed it is Start shift", async ({ page }) => {
    await page.goto("/manage");
    await expect(page.locator(shiftButton("Finish shift"))).toBeVisible();
    await expect(page.locator(shiftButton("Start"))).toHaveCount(0);

    await page.click(shiftButton("Finish shift"));
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("The restaurant closes.");
    await dialog.getByRole("button", { name: "Keep shift open" }).click();
    await expect(page.locator(shiftButton("Finish shift"))).toBeVisible();
  });

  test("finishing names the open tickets, closes the restaurant, and keeps them", async ({ page }) => {
    await assign("A", "waiter", waiter);
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);

    await page.goto("/manage");
    await page.click(shiftButton("Finish shift"));
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByTestId("finish-open-tickets")).toContainText(`Ticket #${saved.ticket_number}, Table ${TABLE}`);
    await dialog.getByRole("button", { name: "Finish shift" }).click();

    await expect(page.getByText("Shift finished. The restaurant is closed.")).toBeVisible();
    await expect(page.locator(shiftButton("Start shift"))).toBeVisible();
    await expect(page.locator(shiftButton("Finish shift"))).toHaveCount(0);
    await expect(page.locator("select[aria-label='Waiter for A']")).toHaveValue("");
    expect(await openTicketsAt(TABLE)).toHaveLength(1);
  });

  test("while closed, waiters can't enter, even from a saved link", async ({ page }) => {
    await page.goto("/waiter");
    await expect(page.getByTestId("restaurant-closed")).toContainText("The restaurant is closed.");
    await expect(page.locator("#employee-number")).toHaveCount(0);

    for (const link of ["/waiter/01", `/waiter/01/tables/${TABLE}`]) {
      await page.goto(link);
      await expect(page).toHaveURL(/\/waiter$/);
      await expect(page.getByTestId("restaurant-closed")).toBeVisible();
    }
  });

  test("the Shift Report shows the finished shift as ended", async ({ page }) => {
    await page.goto("/manage");
    await page.click("section[aria-labelledby='shift-heading'] a:has-text('Shift Report')");
    await expect(page).toHaveURL(/\/manage\/shift-report$/);
    await expect(page.locator("main")).toContainText("Ended ");
    await expect(page.getByTestId("open-tickets")).toContainText("still open");
  });

  test("starting a shift opens the Waiter Section on a screen already showing closed", async ({ page, browser }) => {
    await page.goto("/waiter");
    if (env.realtime) await expect(page.getByTestId("live-status")).toHaveText("Live", { timeout: 20_000 });
    await expect(page.getByTestId("restaurant-closed")).toBeVisible();

    const manager = await browser.newPage({ storageState: "e2e/.auth/admin.json" });
    await manager.goto("/manage");
    await manager.click(shiftButton("Start shift"));
    await manager.locator("dialog[open]").getByRole("button", { name: "Start shift" }).click();
    await expect(manager.locator(shiftButton("Finish shift"))).toBeVisible();
    await manager.close();

    await expect(page.locator("#employee-number")).toBeVisible({ timeout: env.realtime ? 4_000 : 15_000 });
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await expect(page.locator("main")).toContainText("Waiter");
    await expect(page).toHaveURL(new RegExp(`/waiter/01/tables/${TABLE}$`));
  });

  test("a waiter inside is taken out when the manager finishes", async ({ page }) => {
    await page.goto("/waiter/01");
    if (env.realtime) await expect(page.getByTestId("live-status")).toHaveText("Live", { timeout: 20_000 });
    await expect(page.locator("#section-select, select").first()).toBeVisible();

    await finishShift();
    await expect(page.getByTestId("restaurant-closed")).toBeVisible({ timeout: env.realtime ? 4_000 : 15_000 });
    await expect(page).toHaveURL(/\/waiter$/);
  });

  test.afterAll(async () => {
    await startShift();
    await cancelOpenOrders([TABLE]);
  });
});
