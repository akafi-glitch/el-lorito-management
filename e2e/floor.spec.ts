import { expect, test, type Page } from "@playwright/test";

import { audit, clearVisit, freeTables, seat, serveChips, startShift, visitRow } from "./support/db";

const tile = (page: Page, label: string) => page.locator(`main button[aria-label^="${label},"]`).first();
const undoButton = (page: Page, labels: string) => page.getByRole("button", { name: `Undo chips served at ${labels}` });

test.describe.serial("floor management", () => {
  test.beforeAll(async () => {
    await startShift();
    await freeTables(["A1", "A2", "A3", "A4", "A5", "A6", "B3", "B4", "C1", "C2", "C3", "P1", "X6", "X7", "X8", "X9", "X10"]);
  });

  test("all 45 tables are shown with their colors explained", async ({ page }) => {
    await page.goto("/floor");
    await expect(page.locator("main button[aria-label*=', ']").filter({ hasText: /chair|guest|Seats not set/ })).toHaveCount(45);
    for (const label of ["Vacant", "Needs chips", "Chips served", "Section closed"]) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
  });

  test("X tiles show the corrected sections: X(1) has X4-X9, X13, X14; X(2) has X1-X3, X10-X12", async ({ page }) => {
    await page.goto("/floor");
    for (const code of ["X4", "X5", "X6", "X7", "X8", "X9", "X13", "X14"]) await expect(tile(page, code)).toContainText("X(1)");
    for (const code of ["X1", "X2", "X3", "X10", "X11", "X12"]) await expect(tile(page, code)).toContainText("X(2)");
  });

  test("a suggested table is seated; a tap on yellow turns it red with no question; clearing still asks", async ({ page }) => {
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
    await expect(tile(page, table)).toHaveAttribute("aria-label", /Chips served/);
    await expect(page.locator("dialog[open]")).toHaveCount(0); // no confirmation popup
    await expect(undoButton(page, table)).toBeVisible();

    await tile(page, table).click();
    await expect(page.locator("dialog[open]")).toContainText("Is the table cleaned?");
    await page.click("dialog[open] button:text-is('No')");
    await expect(tile(page, table)).toHaveAttribute("aria-label", /Chips served/);
    await tile(page, table).click();
    await page.click("dialog[open] button:has-text('Yes, clear table')");
    await expect(tile(page, table)).toHaveAttribute("aria-label", /Vacant/);
  });

  test("a green table still selects for seating: never marked as chips served", async ({ page }) => {
    await page.goto("/floor");
    await tile(page, "A1").click();
    await expect(tile(page, "A1")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Seat at A1")).toBeVisible();
    await page.click("[aria-label='Seat selected tables'] button:has-text('Cancel')");
    await expect(tile(page, "A1")).toHaveAttribute("aria-label", /Vacant/);
  });

  test("the tap shows at once, while the server is still working", async ({ page }) => {
    const visit = await seat(["A2"], 2);
    await page.goto("/floor");
    await expect(tile(page, "A2")).toHaveAttribute("aria-label", /Needs chips/);

    // Hold every server action back for a second and a half, like a slow connection.
    await page.route("**/floor", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await tile(page, "A2").click();
    await expect(tile(page, "A2")).toHaveAttribute("aria-label", /Chips served/, { timeout: 400 });
    expect((await visitRow(visit)).chips_status).toBe("needed"); // the server hasn't even been asked yet
    await expect(tile(page, "A3")).toBeEnabled(); // the rest of the floor stays usable
    await expect.poll(async () => (await visitRow(visit)).chips_status, { timeout: 10_000 }).toBe("served");
    await page.unroute("**/floor");
  });

  test("Undo restores yellow, and both changes are in the history", async ({ page }) => {
    const visit = await seat(["A3"], 2);
    await page.goto("/floor");
    await tile(page, "A3").click();
    await undoButton(page, "A3").click();
    await expect(tile(page, "A3")).toHaveAttribute("aria-label", /Needs chips/);
    await expect(page.getByText("Undone: the table needs chips again.")).toBeVisible();
    await expect.poll(async () => (await visitRow(visit)).chips_status).toBe("needed");
    expect(await audit(visit)).toEqual(["seated", "chips_served", "chips_undone"]);
  });

  test("Undo is also on the red table itself, for any employee", async ({ page }) => {
    const visit = await seat(["A4"], 2);
    await serveChips(visit); // another employee
    await page.goto("/floor");
    await expect(tile(page, "A4")).toHaveAttribute("aria-label", /Chips served/);
    await tile(page, "A4").click();
    await page.click("dialog[open] button:has-text('Undo chips served')");
    await expect(tile(page, "A4")).toHaveAttribute("aria-label", /Needs chips/);
    await expect.poll(async () => (await visitRow(visit)).chips_status).toBe("needed");
  });

  test("Undo refuses to overwrite what another employee did since", async ({ page }) => {
    const visit = await seat(["A5"], 2);
    await page.goto("/floor");
    await tile(page, "A5").click();
    await expect(undoButton(page, "A5")).toBeVisible();
    await expect.poll(async () => (await visitRow(visit)).chips_status).toBe("served");

    await clearVisit(visit); // another employee clears the table
    await undoButton(page, "A5").click();
    await expect(page.locator("main [role=alert]")).toContainText("already cleared, so nothing was undone");
    await expect(tile(page, "A5")).toHaveAttribute("aria-label", /Vacant/);
    expect((await visitRow(visit)).cleared_at).not.toBeNull();
    expect(await audit(visit)).toEqual(["seated", "chips_served", "cleared"]);
  });

  test("joined tables change and undo together; X6 + X7 + X8 still seats together", async ({ page }) => {
    await freeTables(["X6", "X7", "X8"]);
    const visit = await seat(["X6", "X7", "X8"], 14, "X6+X7+X8");
    await page.goto("/floor");
    await expect(tile(page, "X7")).toHaveAttribute("aria-label", /joined with X6 and X8/);
    await tile(page, "X7").click();
    for (const code of ["X6", "X7", "X8"]) await expect(tile(page, code)).toHaveAttribute("aria-label", /Chips served/);
    await undoButton(page, "X6 + X7 + X8").click();
    for (const code of ["X6", "X7", "X8"]) await expect(tile(page, code)).toHaveAttribute("aria-label", /Needs chips/);
    await expect.poll(async () => (await visitRow(visit)).chips_status).toBe("needed");
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
