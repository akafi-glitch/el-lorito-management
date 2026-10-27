import { expect, test, type Page } from "@playwright/test";

import { employee, freeTables, printAttempts, saveTicket, seat, setItem, ticketByNumber, ticketTotal, visitCleared } from "./support/db";

const item = (page: Page, name: string) => page.locator(`button[aria-label^='Add ${name},']`).first();
const category = (page: Page, name: string) => page.click(`nav[aria-label='Menu categories'] button:text-is('${name}')`);
const order = (page: Page) => page.locator("#current-order");
const status = (page: Page) => page.getByTestId("ticket-status");

/** The browser's print dialog can't be driven in a test: count the calls and keep the receipt text. */
async function stubPrinting(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: number; __receipts: string[]; print: () => void };
    w.__prints = 0;
    w.__receipts = [];
    w.print = () => {
      w.__prints += 1;
      w.__receipts.push(document.querySelector("[data-testid=receipt]")?.textContent ?? "");
    };
  });
}
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);
const lastReceipt = (page: Page) =>
  page.evaluate(() => (window as unknown as { __receipts: string[] }).__receipts.at(-1) ?? "");

test.describe.serial("tickets, tax, and printing", () => {
  let visitId = 0;
  let kafi = 0;
  const table = "X9";

  test.beforeAll(async () => {
    kafi = await employee("01", "Kafi", "waiter");
    await setItem("Combo #5", 940, true);
    await setItem("Domestic beer", 499, true);
    await setItem("Taco", 235, true);
    visitId = await seat([table], 4);
  });

  test.afterAll(async () => {
    await freeTables([table]);
  });

  test("build an order: categories, search, quantities, remove, and the taxes", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${table}?continue=1`);
    await expect(page.locator("#order-heading")).toContainText("New ticket");
    await expect(page.locator("nav[aria-label='Menu categories'] button")).toHaveCount(26);

    await category(page, "Combination Dinners");
    await item(page, "Combo #5").click();
    await item(page, "Combo #5").click();
    await page.fill("#menu-search", "domestic");
    await item(page, "Domestic beer").click();
    await page.fill("#menu-search", "chile con queso");
    await item(page, "Chile con queso").click();
    await page.click("button[aria-label='Remove Chile con queso']");
    await expect(order(page)).not.toContainText("Chile con queso");

    // $18.80 food + $4.99 beer -> $1.60 + $0.52 tax -> $25.91
    for (const part of ["Food subtotal$18.80", "Liquor subtotal$4.99", "Food tax (8.5%)$1.60", "Liquor tax (10.5%)$0.52", "Total$25.91"]) {
      await expect(order(page)).toContainText(part, { useInnerText: false });
    }
    await expect(status(page)).toHaveText("Not saved yet.");
  });

  test("save, change, undo, and save changes; the database agrees on the total", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${table}?continue=1`);
    await category(page, "Combination Dinners");
    await item(page, "Combo #5").click();
    await item(page, "Combo #5").click();
    await category(page, "Beer");
    await item(page, "Domestic beer").click();
    await page.click("button:has-text('Save ticket')");
    const saved = page.getByText(/Ticket #\d+ saved\./);
    await expect(saved).toBeVisible();
    const number = Number((await saved.textContent())!.match(/#(\d+)/)![1]);
    await expect(page).toHaveURL(new RegExp(`ticket=${number}`));
    expect(await ticketTotal(number)).toBe(2591);
    await expect(page.getByTestId("ticket-total")).toHaveText("$25.91");

    await page.click("button[aria-label='One more Domestic beer']");
    await expect(status(page)).toHaveText("Changes not saved yet.");
    await page.click("button:has-text('Undo changes')");
    await expect(status(page)).toContainText("Saved.");

    await setItem("Combo #5", 1000, true); // a menu price change after saving
    await page.reload();
    await page.click("button[aria-label='One more Combo #5']");
    await expect(order(page)).toContainText("Combo #5$28.20"); // the saved line keeps $9.40
    await page.click("button:has-text('Save changes')");
    await expect(status(page)).toContainText("Saved.");
    expect((await ticketByNumber(number)).version).toBe(2);
    await setItem("Combo #5", 940, true);
  });

  test("print: save first, lock, receipt, 'Did it print?', print again, home; the table stays seated", async ({ page }) => {
    await stubPrinting(page);
    await page.goto(`/waiter/01/tables/${table}?continue=1`);
    await item(page, "Lunch #3").click();
    await page.click("button:has-text('Save and print')");
    await expect(page.locator("dialog[open] h2")).toHaveText(/Did ticket #\d+ print\?/);
    const number = Number((await page.locator("dialog[open] h2").textContent())!.match(/#(\d+)/)![1]);
    expect(await prints(page)).toBe(1);

    const receipt = (await lastReceipt(page)).replace(/\s+/g, "");
    for (const part of ["ELLORITO", "MexicanRestaurant", `Ticket#${number}`, `Table${table}`, "Waiter#01", "1Lunch#3", "Foodsubtotal", "Liquorsubtotal", "Foodtax(8.5%)", "Liquortax(10.5%)", "TOTAL$"]) {
      expect(receipt).toContain(part);
    }
    expect(receipt).not.toContain("Kafi");
    const ticket = await ticketByNumber(number);
    expect(ticket.status).toBe("printed");
    expect(await printAttempts(ticket.id)).toEqual([{ attempt_no: 1, kind: "first", outcome: "unknown" }]);

    await page.click("dialog[open] button:has-text('No, it didn')");
    await expect(page.locator("dialog[open] h2")).toHaveText(`Ticket #${number} didn't print`);
    await page.click("dialog[open] button:has-text('Print again')");
    await expect(page.locator("dialog[open] h2")).toHaveText(`Did ticket #${number} print?`);
    expect(await prints(page)).toBe(2);
    await page.click("dialog[open] button:has-text('Yes, it printed')");
    await expect(page).toHaveURL(/\/$/);
    expect(await printAttempts(ticket.id)).toEqual([
      { attempt_no: 1, kind: "first", outcome: "not_printed" },
      { attempt_no: 2, kind: "reprint", outcome: "printed" },
    ]);
    expect(await visitCleared(visitId)).toBe(false);

    // Locked for good, printable again any time
    await page.goto(`/waiter/01/tables/${table}?continue=1&ticket=${number}`);
    await expect(page.getByText("Printed: locked for good.")).toBeVisible();
    await page.click("button:has-text('Print again')");
    await page.click("dialog[open] button:has-text('Yes, it printed')");
    await expect(page).toHaveURL(/\/$/);
    expect(await printAttempts(ticket.id)).toHaveLength(3);
  });

  test("a ticket changed on another device can't be overwritten or printed from an old screen", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${table}?continue=1`);
    await item(page, "Lunch #1").click();
    await page.click("button:has-text('Save ticket')");
    const saved = page.getByText(/Ticket #\d+ saved\./);
    await expect(saved).toBeVisible();
    const number = Number((await saved.textContent())!.match(/#(\d+)/)![1]);
    await expect(status(page)).toContainText("Saved.");
    const ticket = await ticketByNumber(number);

    await page.click("button[aria-label='One more Lunch #1']"); // unsaved change here
    await saveTicket(visitId, kafi, [["Lunch #1", 1], ["Horchata", 1]], { id: ticket.id, version: ticket.version }); // the other device
    await expect(page.getByText("Someone else just saved a change to this ticket")).toBeVisible();
    await page.click("button:has-text('Show their version')");
    await expect(order(page)).toContainText("Horchata");

    await page.click("button:has-text('Cancel this ticket')");
    await page.click("dialog[open] button:text-is('Cancel ticket')");
    await expect(page.getByText(`Ticket #${number} cancelled.`)).toBeVisible();
    expect((await ticketByNumber(number)).status).toBe("cancelled");
  });
});
