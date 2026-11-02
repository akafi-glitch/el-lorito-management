import { expect, test, type Page } from "@playwright/test";

import { assign, employee, freeTables, seat, setEmployeeActive, startShift, ticketOfVisit, visitRow } from "./support/db";

async function enter(page: Page, number: string) {
  await page.goto("/waiter");
  await page.fill("#employee-number", number);
  await page.click("button:has-text('Show my tables')");
}

const tableOptions = async (page: Page) =>
  (await page.locator("#pick-table option").allTextContents()).slice(1).map((text) => text.split(" (")[0]);

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

  test("the number pad finds 01 from 1, and offers two dropdowns", async ({ page }) => {
    await page.goto("/waiter");
    await page.click("[aria-label='Number pad'] button:text-is('1')");
    await page.click("button:has-text('Show my tables')");
    await expect(page).toHaveURL(/\/waiter\/01$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kafi (01)");
    await expect(page.locator("main")).toContainText("Assigned this shift: X(1)");
    await expect(page.locator("#pick-section option")).toHaveText(["Choose a section…", "A", "B", "C", "X(1)", "X(2)", "P", "Party", "Bar"]);
    await expect(page.locator("#pick-section")).toHaveValue("X-1"); // their section first, nothing more
  });

  test("the table dropdown follows the section: exactly its tables", async ({ page }) => {
    await page.goto("/waiter/01");
    await page.selectOption("#pick-section", { label: "X(1)" });
    expect(await tableOptions(page)).toEqual(["X4", "X5", "X6", "X7", "X8", "X9", "X13", "X14"]);
    await page.selectOption("#pick-section", { label: "X(2)" });
    expect(await tableOptions(page)).toEqual(["X1", "X2", "X3", "X10", "X11", "X12"]);
    await page.selectOption("#pick-section", { label: "Party" });
    expect(await tableOptions(page)).toEqual(["Party 1", "Party 2", "Party 3"]);
    await page.selectOption("#pick-section", { label: "Bar" });
    expect(await tableOptions(page)).toEqual(["Bar 1", "Bar 2", "Bar 3", "Bar 4"]);
  });

  test("changing the section forgets a table of the old section", async ({ page }) => {
    await page.goto("/waiter/01");
    await page.selectOption("#pick-section", { label: "X(2)" });
    await page.selectOption("#pick-table", "X2");
    await page.selectOption("#pick-section", { label: "A" });
    await expect(page.locator("#pick-table")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Open table" })).toBeDisabled();
  });

  test("any waiter opens any table, with no warning: another waiter's table, their own, the Bar", async ({ page }) => {
    for (const [section, table, urlPart] of [
      ["B", "B3", "B3"], // assigned to Musfika
      ["X(2)", "X2", "X2"],
      ["Bar", "BAR-1", "BAR-1"],
    ] as const) {
      await page.goto("/waiter/01");
      await page.selectOption("#pick-section", { label: section });
      await page.selectOption("#pick-table", table);
      await page.click("button:has-text('Open table')");
      await expect(page).toHaveURL(new RegExp(`/tables/${urlPart}$`));
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("assigned to");
      await expect(page.locator("#menu-search")).toBeVisible();
    }
  });

  test("a table with nobody seated can be seated right there: the same visit the Floor shows", async ({ page }) => {
    await page.goto("/waiter/01");
    await page.selectOption("#pick-section", { label: "X(2)" });
    await page.selectOption("#pick-table", "X3");
    await page.click("button:has-text('Open table')");
    await expect(page.locator("main")).toContainText("No guests are seated at X3 yet");
    await page.fill("#seat-guests", "2");
    await page.click("button:has-text('Seat and start the order')");
    await expect(page.locator("#menu-search")).toBeVisible();
    await page.goto("/floor");
    await expect(page.locator("main button[aria-label^='X3,']")).toHaveAttribute("aria-label", /2 guests, Needs chips/);
  });

  test("a closed section's table can't be seated from here either", async ({ page }) => {
    await freeTables(["C6"]);
    await page.goto("/floor");
    await page.click("button[aria-label='Close section C']");
    await expect(page.locator("main button[aria-label^='C6,']")).toHaveAttribute("aria-label", /Section closed/);
    await page.goto("/waiter/01/tables/C6");
    await page.fill("#seat-guests", "2");
    await page.click("button:has-text('Seat and start the order')");
    await expect(page.locator("main p[role=alert]")).toContainText("Section C is closed");
    await freeTables(["C6"]); // opens the section again
  });

  test("the waiter's number stays on what they save, wherever they are assigned", async ({ page }) => {
    const visit = await seat(["X9"], 2);
    await page.goto("/waiter/01/tables/X9");
    await page.click("button[aria-label^='Add Lunch #1,']");
    await page.click("button:text-is('Save Order')");
    await expect(page.getByText(/Order saved on ticket #\d+\./)).toBeVisible();
    expect((await ticketOfVisit(visit))[0]?.employee_id).toBe(kafi);
    expect((await visitRow(visit)).cleared_at).toBeNull();
    await freeTables(["X9"]);
  });
});
