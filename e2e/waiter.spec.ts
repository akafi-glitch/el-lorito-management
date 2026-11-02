import { expect, test, type Page } from "@playwright/test";

import { assign, cancelOpenOrders, employee, freeTables, openTicketsAt, seat, setEmployeeActive, startShift } from "./support/db";

async function enter(page: Page, number: string) {
  await page.goto("/waiter");
  await page.fill("#employee-number", number);
  await page.click("button:has-text('Show my tables')");
}

const tableLinks = (page: Page) => page.locator("nav[aria-labelledby='pick-table-heading'] a");

test.describe.serial("waiter section", () => {
  let kafi = 0;

  test.beforeAll(async () => {
    await startShift();
    kafi = await employee("01", "Kafi", "waiter");
    const musfika = await employee("02", "Musfika", "waiter");
    const off = await employee("04", "Luis", "waiter");
    await setEmployeeActive(off, "Luis", false);
    await assign("X-1", "waiter", kafi);
    await assign("B", "waiter", musfika);
    await freeTables(["X2", "X3", "B3", "BAR-1", "C6"]);
    await cancelOpenOrders(["X2", "X3", "X9", "C6"]);
    await seat(["X2"], 4);
    await seat(["B3"], 3);
    await seat(["BAR-1"], 1);
  });

  test("unknown and turned-off numbers are refused", async ({ page }) => {
    await enter(page, "777");
    await expect(page.locator("#employee-number-error")).toContainText("No employee has number 777");
    await enter(page, "4");
    await expect(page.locator("#employee-number-error")).toContainText("Luis (04) is turned off");
  });

  test("the number pad finds 01 from 1, and offers the sections", async ({ page }) => {
    await page.goto("/waiter");
    await page.click("[aria-label='Number pad'] button:text-is('1')");
    await page.click("button:has-text('Show my tables')");
    await expect(page).toHaveURL(/\/waiter\/01$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kafi (01)");
    await expect(page.locator("main")).toContainText("Assigned this shift: X(1)");
    await expect(page.locator("#pick-section option")).toHaveText(["Choose a section…", "A", "B", "C", "X(1)", "X(2)", "P", "Party", "Bar"]);
    await expect(page.locator("#pick-section")).toHaveValue("X-1"); // their section first, nothing more
  });

  test("the table list follows the section: exactly its tables, and nothing about who is seated", async ({ page }) => {
    await page.goto("/waiter/01");
    await page.selectOption("#pick-section", { label: "X(1)" });
    await expect(tableLinks(page)).toHaveText(["X4", "X5", "X6", "X7", "X8", "X9", "X13", "X14"]);
    await page.selectOption("#pick-section", { label: "X(2)" });
    await expect(tableLinks(page)).toHaveText(["X1", "X2", "X3", "X10", "X11", "X12"]); // X2 has 4 guests seated
    await page.selectOption("#pick-section", { label: "Party" });
    await expect(tableLinks(page)).toHaveText(["Party 1", "Party 2", "Party 3"]);
    await page.selectOption("#pick-section", { label: "Bar" });
    await expect(tableLinks(page)).toHaveText(["Bar 1", "Bar 2", "Bar 3", "Bar 4"]);
    await page.selectOption("#pick-section", { label: "Choose a section…" });
    await expect(tableLinks(page)).toHaveCount(0);
  });

  test("any waiter opens any table, with no warning: another waiter's table, their own, the Bar", async ({ page }) => {
    for (const [section, table, urlPart] of [
      ["B", "B3", "B3"], // assigned to Musfika
      ["X(2)", "X2", "X2"],
      ["Bar", "BAR-1", "BAR-1"],
    ] as const) {
      await page.goto("/waiter/01");
      await page.selectOption("#pick-section", { label: section });
      await tableLinks(page).filter({ hasText: new RegExp(`^${table.replace("BAR-", "Bar ")}$`) }).click();
      await expect(page).toHaveURL(new RegExp(`/tables/${urlPart}$`));
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("assigned to");
      await expect(page.locator("#menu-search")).toBeVisible();
    }
  });

  test("a vacant table goes straight to its order page, and ordering doesn't touch the Floor", async ({ page }) => {
    await page.goto("/waiter/01");
    await page.selectOption("#pick-section", { label: "X(2)" });
    await tableLinks(page).filter({ hasText: /^X3$/ }).click();
    await expect(page).toHaveURL(/\/tables\/X3$/);
    await expect(page.locator("#menu-search")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/guests/i);
    await page.click("button[aria-label^='Add Lunch #1,']");
    await page.click("button:text-is('Save Order')");
    await expect(page.getByText(/Order saved on ticket #\d+\./)).toBeVisible();
    expect((await openTicketsAt("X3"))[0]?.visit_id).toBeNull();
    await page.goto("/floor");
    await expect(page.locator("main button[aria-label^='X3,']")).toHaveAttribute("aria-label", /Vacant/);
  });

  test("a seated table looks the same, and the Floor clearing it leaves the order alone", async ({ page }) => {
    await page.goto("/waiter/01/tables/X2");
    await expect(page.locator("main")).not.toContainText(/guests/i);
    await page.click("button[aria-label^='Add Lunch #1,']");
    await page.click("button:text-is('Save Order')");
    await expect(page.getByText(/Order saved on ticket #\d+\./)).toBeVisible();
    const [ticket] = await openTicketsAt("X2");
    await freeTables(["X2"]);
    expect((await openTicketsAt("X2"))[0]?.ticket_number).toBe(ticket?.ticket_number);
    await page.reload();
    await expect(page.locator("#saved-ticket-heading")).toHaveText(`Ticket #${ticket?.ticket_number}`);
  });

  test("a closed section's table can still take an order", async ({ page }) => {
    await page.goto("/floor");
    await page.click("button[aria-label='Close section C']");
    await expect(page.locator("main button[aria-label^='C6,']")).toHaveAttribute("aria-label", /Section closed/);
    await page.goto("/waiter/01/tables/C6");
    await page.click("button[aria-label^='Add Lunch #1,']");
    await page.click("button:text-is('Save Order')");
    await expect(page.getByText(/Order saved on ticket #\d+\./)).toBeVisible();
    await freeTables(["C6"]); // opens the section again
  });

  test("the waiter's number stays on what they save, wherever they are assigned", async ({ page }) => {
    await page.goto("/waiter/01/tables/X9");
    await page.click("button[aria-label^='Add Lunch #1,']");
    await page.click("button:text-is('Save Order')");
    await expect(page.getByText(/Order saved on ticket #\d+\./)).toBeVisible();
    expect((await openTicketsAt("X9"))[0]?.employee_id).toBe(kafi);
  });
});
