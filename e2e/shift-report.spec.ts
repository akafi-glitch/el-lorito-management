import { expect, test } from "@playwright/test";

import { cancelOpenOrders, cancelTicket, employee, finalizeTicket, saveOrder, setItem, startShift, ticketTotal } from "./support/db";
import { unlock } from "./support/pin";

test.beforeEach(async ({ page }) => {
  await unlock(page, "/manage/shift-report");
});

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const TABLES = ["P1", "P2", "P3", "P4"];

test.describe.serial("management: shift report", () => {
  let waiter = 0;
  let firstShift = 0;
  let sold1 = 0;
  let sold2 = 0;
  let stillOpen = 0;
  let cancelled = 0;
  let total1 = 0;
  let total2 = 0;
  let lastShiftSale = 0;
  let lastShiftTotal = 0;

  test.beforeAll(async () => {
    waiter = await employee("63", "Report Waiter", "waiter");
    await setItem("Taco", 235, true);
    await setItem("Domestic beer", 499, true);
    await cancelOpenOrders(TABLES);

    firstShift = await startShift();
    const a = await saveOrder("P1", waiter, [["Taco", 2], ["Domestic beer", 1]]);
    const b = await saveOrder("P2", waiter, [["Taco", 1]]);
    const c = await saveOrder("P3", waiter, [["Taco", 3]]);
    const d = await saveOrder("P4", waiter, [["Domestic beer", 2]]);
    sold1 = a.ticket_number;
    sold2 = b.ticket_number;
    stillOpen = c.ticket_number;
    cancelled = d.ticket_number;
    await finalizeTicket(a.ticket_id, waiter);
    await finalizeTicket(b.ticket_id, waiter);
    await cancelTicket(d.ticket_id, waiter);
    total1 = await ticketTotal(sold1);
    total2 = await ticketTotal(sold2);

    await startShift();
    const e = await saveOrder("P4", waiter, [["Taco", 1]]);
    await finalizeTicket(e.ticket_id, waiter);
    lastShiftSale = e.ticket_number;
    lastShiftTotal = await ticketTotal(lastShiftSale);
  });

  test.afterAll(async () => {
    await cancelOpenOrders(TABLES);
  });

  test("is a tab of its own, opens on the latest shift, and Order History stays as it was", async ({ page }) => {
    await page.goto("/manage");
    await page.click("nav[aria-label='Management'] a:has-text('Shift Report')");
    await expect(page).toHaveURL(/\/manage\/shift-report$/);
    await expect(page.getByTestId("report-row")).toHaveCount(1);
    await expect(page.getByTestId("report-row")).toContainText(`#${lastShiftSale}`);
    await expect(page.getByTestId("shift-total")).toHaveText(money(lastShiftTotal));

    await page.click("nav[aria-label='Management'] a:has-text('Order History')");
    await expect(page.locator("thead th")).toHaveText(["Ticket", "Date and time", "Shift started", "Waiter", "Table", "Total", "Status"]);
  });

  test("an earlier shift: only sold tickets and their total; open ones are named apart", async ({ page }) => {
    await page.goto("/manage/shift-report");
    await page.selectOption("#report-shift", String(firstShift));
    await expect(page).toHaveURL(new RegExp(`shift=${firstShift}$`));

    await expect(page.locator("thead th")).toHaveText(["Ticket", "Total"]);
    await expect(page.getByTestId("report-row").locator("td:first-child")).toHaveText([`#${sold1}`, `#${sold2}`]);
    await expect(page.getByTestId("report-row").locator("td:last-child")).toHaveText([money(total1), money(total2)]);
    await expect(page.getByTestId("shift-total")).toHaveText(money(total1 + total2));
    await expect(page.getByTestId("open-tickets")).toContainText(`#${stillOpen}`);
    await expect(page.locator("main")).not.toContainText(`#${cancelled}`);
    await expect(page.locator("main")).not.toContainText("Taco");
    await expect(page.locator("main")).toContainText("Ended ");
  });

  test("prints ticket numbers, totals, and the shift total, and nothing else", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        (window as unknown as { printed: string[] }).printed.push(document.querySelector("[data-testid=shift-report-print]")?.textContent ?? "");
      };
      (window as unknown as { printed: string[] }).printed = [];
    });
    await page.goto(`/manage/shift-report?shift=${firstShift}`);
    await page.getByRole("button", { name: "Print Shift Report" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printed: string[] }).printed.length)).toBe(1);
    const printed = await page.evaluate(() => (window as unknown as { printed: string[] }).printed[0]!);

    for (const part of ["EL LORITO", "SHIFT REPORT", "STARTED:", "ENDED:", "PRINTED:", `#${sold1}`, money(total1), `#${sold2}`, money(total2), "TICKETS: 2", "SHIFT TOTAL", money(total1 + total2), "STILL OPEN", `#${stillOpen}`]) {
      expect(printed).toContain(part);
    }
    expect(printed).not.toContain(`#${cancelled}`);
    expect(printed).not.toContain("Taco");
    expect(printed).not.toContain("WAITER");

    // Leaves the screen as it was, ready to print again.
    await expect(page.getByRole("button", { name: "Print Shift Report" })).toBeEnabled();
    await expect(page.locator("[data-testid=shift-report-print]")).toHaveCount(0);
  });

  test("nothing to print: says so, and the button is off", async ({ page }) => {
    await startShift();
    await page.goto("/manage/shift-report");
    await expect(page.getByTestId("shift-total")).toHaveText("$0.00");
    await expect(page.locator("main")).toContainText("No customer receipts were printed in this shift.");
    await expect(page.getByRole("button", { name: "Print Shift Report" })).toBeDisabled();
  });
});
