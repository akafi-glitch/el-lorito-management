import { expect, test, type Page } from "@playwright/test";

import { auditFrom, cancelOpenOrders, employee, openTicketsAt, setItem, startShift, ticketByNumber } from "./support/db";

const SPOTS = ["TOGO-1", "TOGO-2", "TOGO-3"];
const saved = (page: Page) => page.locator("section[aria-labelledby='saved-ticket-heading']");
const addTaco = async (page: Page) => {
  await page.fill("#menu-search", "Taco");
  await page.locator("button[aria-label^='Add Taco,']").first().click();
};
const stubPrinting = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __receipts: string[]; print: () => void };
    w.__receipts = [];
    w.print = () => {
      w.__receipts.push(document.querySelector(".receipt-print")?.textContent ?? "");
    };
  });
const lastReceipt = (page: Page) => page.evaluate(() => (window as unknown as { __receipts: string[] }).__receipts.at(-1) ?? "");

test.describe.serial("to-go orders", () => {
  test.beforeAll(async () => {
    await startShift();
    await employee("01", "Kafi", "waiter");
    await setItem("Taco", 235, true);
    await cancelOpenOrders(SPOTS);
  });

  test.afterAll(async () => {
    await cancelOpenOrders(SPOTS);
  });

  test("To-Go Order in the dropdown goes straight to the menu, with no table to choose", async ({ page }) => {
    await page.goto("/waiter/01");
    await page.selectOption("#pick-section", { label: "To-Go Order" });
    await expect(page).toHaveURL(/\/waiter\/01\/to-go$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("To-Go Order");
    await expect(page.locator("#menu-search")).toBeVisible();
    await expect(page.locator("#current-order")).toContainText("New to-go order");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("a waiter with a section finds it under the other-section question", async ({ page }) => {
    await page.goto("/waiter/01");
    const another = page.getByRole("button", { name: "Want to take order from another section?" });
    if (await another.count()) await another.click();
    await expect(page.locator("#pick-section option", { hasText: "To-Go Order" })).toHaveCount(1);
  });

  test("the Floor, the board, and the sections never show the to-go spots", async ({ page }) => {
    await page.goto("/floor");
    await expect(page.locator("main button[aria-label^='A1,']")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("To-Go");
    await page.goto("/manage");
    await expect(page.locator("select[aria-label='Waiter for A']")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("To-Go");
    await page.goto("/waiter/01");
    await expect(page.locator("nav[aria-labelledby='pick-table-heading'] a", { hasText: "To-Go" })).toHaveCount(0);
  });

  test("saving gives it a spot and its own page, and nothing is saved before that", async ({ page }) => {
    const since = new Date().toISOString();
    await page.goto("/waiter/01/to-go");
    await addTaco(page);
    expect(await openTicketsAt("TOGO-1")).toHaveLength(0);
    expect((await auditFrom(since)).filter((event) => event.event_type === "order_saved")).toHaveLength(0);

    await page.getByRole("button", { name: "Save Order", exact: true }).click();
    await expect(page).toHaveURL(/\/waiter\/01\/tables\/TOGO-1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("To-Go 1");
    await expect(saved(page)).toContainText("1 × Taco");
    await expect(page.locator("main")).toContainText("Kitchen Receipt Saved");
    expect(await openTicketsAt("TOGO-1")).toHaveLength(1);
  });

  test("a second customer gets their own order, and open ones are listed to get back to", async ({ page }) => {
    await page.goto("/waiter/01/to-go");
    await expect(page.locator("nav[aria-labelledby='open-to-go-heading'] a")).toContainText(["To-Go 1"]);
    await addTaco(page);
    await page.getByRole("button", { name: "Save Order", exact: true }).click();
    await expect(page).toHaveURL(/\/tables\/TOGO-2$/);

    const first = (await openTicketsAt("TOGO-1"))[0]!;
    const second = (await openTicketsAt("TOGO-2"))[0]!;
    expect(second.ticket_number).not.toBe(first.ticket_number);

    await page.goto("/waiter/01/to-go");
    const open = page.locator("nav[aria-labelledby='open-to-go-heading'] a");
    await expect(open).toHaveCount(2);
    await open.filter({ hasText: "To-Go 1" }).click();
    await expect(page).toHaveURL(/\/tables\/TOGO-1$/);
    await expect(page.locator("#saved-ticket-heading")).toContainText(`#${first.ticket_number}`);
  });

  test("Print Kitchen Receipt straight from a new order saves, prints the spot, and moves to its page", async ({ page }) => {
    await stubPrinting(page);
    await page.goto("/waiter/01/to-go");
    await addTaco(page);
    await page.getByRole("button", { name: "Print Kitchen Receipt", exact: true }).click();
    await expect(page).toHaveURL(/\/tables\/TOGO-3$/, { timeout: 15_000 });
    expect(await lastReceipt(page)).toContain("TABLE: TO-GO 3");
    await expect(page.locator("main")).toContainText("Kitchen Receipt Printed");
    await expect(saved(page)).toContainText("Sent to the kitchen");
  });

  test("the rest is the same: the customer receipt names the spot, finishes it, and frees it", async ({ page }) => {
    await stubPrinting(page);
    const ticket = (await openTicketsAt("TOGO-1"))[0]!;
    await page.goto("/waiter/01/tables/TOGO-1");
    await page.getByRole("button", { name: "Print Customer Receipt", exact: true }).click();
    await expect(page.getByText(`Ticket #${ticket.ticket_number} is finalized.`)).toBeVisible();
    expect((await ticketByNumber(ticket.ticket_number)).status).toBe("finalized");
    expect(await lastReceipt(page)).toContain("TABLE: To-Go 1");

    await page.goto("/waiter/01/to-go");
    await addTaco(page);
    await page.getByRole("button", { name: "Save Order", exact: true }).click();
    await expect(page).toHaveURL(/\/tables\/TOGO-1$/); // the first free spot again
  });
});
