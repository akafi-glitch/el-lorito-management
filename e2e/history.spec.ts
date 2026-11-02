import { expect, test } from "@playwright/test";

import { employee, freeTables, saveOrder, seat, setItem, startShift, ticketByNumber } from "./support/db";

const rows = (page: import("@playwright/test").Page) => page.getByTestId("history-row");

test.describe.serial("management: order history", () => {
  let first = 0;
  let second = 0;
  let third = 0;
  let firstShift = 0;
  let secondShift = 0;

  test.beforeAll(async () => {
    const hist1 = await employee("61", "History One", "waiter");
    const hist2 = await employee("62", "History Two", "waiter");
    await setItem("Taco", 235, true);
    await setItem("Domestic beer", 499, true);

    firstShift = await startShift();
    first = (await saveOrder(await seat(["P1"], 2), hist1, [["Taco", 2], ["Domestic beer", 1]])).ticket_number;
    await new Promise((resolve) => setTimeout(resolve, 20));
    second = (await saveOrder(await seat(["P2"], 2), hist2, [["Taco", 1]])).ticket_number;

    secondShift = await startShift();
    third = (await saveOrder(await seat(["P3"], 2), hist1, [["Domestic beer", 2]])).ticket_number;
    await freeTables(["P1"]); // a table going vacant must not lose its ticket
  });

  test.afterAll(async () => {
    await freeTables(["P2", "P3"]);
  });

  test("is under Management, most recent first, with totals including tax and no food items", async ({ page }) => {
    await page.goto("/manage");
    await page.click("nav[aria-label='Management'] a:has-text('Order History')");
    await expect(page).toHaveURL(/\/manage\/history$/);
    await expect(page.locator("thead th")).toHaveText(["Ticket", "Date and time", "Shift started", "Waiter", "Table", "Total", "Status"]);

    const numbers = (await rows(page).locator("td:first-child").allTextContents()).map((text) => Number(text.replace("#", "")));
    expect(numbers.slice(0, 3)).toEqual([third, second, first]);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

    // $4.70 + $4.99: $0.40 + $0.52 tax -> $10.61
    const row = rows(page).filter({ hasText: `#${first}` });
    await expect(row).toContainText("61");
    await expect(row).toContainText("P1");
    await expect(row).toContainText("$10.61");
    await expect(page.locator("table")).not.toContainText("Taco");
    await expect(page.locator("table")).not.toContainText("Domestic beer");
  });

  test("filters by shift and by waiter, and sorts", async ({ page }) => {
    await page.goto("/manage/history");
    await page.selectOption("#history-shift", String(firstShift));
    await expect(page).toHaveURL(new RegExp(`shift=${firstShift}`));
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText(`#${second}`);

    await page.selectOption("#history-waiter", "61");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`#${first}`);

    await page.goto(`/manage/history?shift=${secondShift}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`#${third}`);

    await page.goto(`/manage/history?shift=${firstShift}`);
    await page.selectOption("#history-sort", "oldest");
    await expect(page).toHaveURL(/sort=oldest/);
    await expect(rows(page).first()).toContainText(`#${first}`);
  });

  test("old amounts stay put when the menu price changes", async ({ page }) => {
    await setItem("Taco", 999, true);
    await page.goto(`/manage/history?shift=${firstShift}&waiter=61`);
    await expect(rows(page).first()).toContainText("$10.61");
    await setItem("Taco", 235, true);
  });

  test("keeps the waiter who took the order, and the ticket after the table went vacant", async ({ page }) => {
    await page.goto(`/manage/history/${first}`);
    await expect(page.locator("main")).toContainText(`Ticket #${first}`);
    await expect(page.locator("main")).toContainText("History One (61)");
    await expect(page.locator("main")).toContainText("2 × Taco"); // items are on the ticket's own page
    expect((await ticketByNumber(first)).status).toBe("open");
    await page.goto(`/manage/history/999999`);
    await expect(page.locator("main [role=alert]")).toContainText("No ticket has that number.");
  });
});
