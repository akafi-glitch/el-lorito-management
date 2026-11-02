import { expect, test, type Locator, type Page } from "@playwright/test";

import { currentRotation, freeTables, seat, startShift } from "./support/db";
import { testEnv } from "./support/env";

const editor = (page: Page) => page.locator("section[aria-labelledby='rotation-heading']");
const shownOrder = async (where: Locator) =>
  (await where.getByTestId("rotation-row").locator("span:nth-child(2)").allTextContents()).map((text) => text.trim());
const moveEarlier = async (where: Locator, name: string, times: number) => {
  const button = where.getByRole("button", { name: `Move ${name} earlier`, exact: true });
  for (let i = 0; i < times; i += 1) await button.click();
};

test.describe.serial("the manager's seating rotation", () => {
  const env = testEnv();

  test.beforeAll(async () => {
    await startShift();
    await freeTables(["A1", "A2", "X1", "X4", "X10", "X11", "P1"]);
  });

  test("starting a shift shows the sections to arrange, and saves the order", async ({ page }) => {
    await seat(["A1"], 2); // someone is seated across the shift change
    await page.goto("/manage");
    await page.click("section[aria-labelledby='shift-heading'] button:has-text('Start new shift')");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Put the sections in the order");
    expect(await shownOrder(dialog)).toEqual(["A", "C", "B", "X(1)", "X(2)", "P"]);

    // A, C, B, X(1), X(2), P -> X(2), X(1), A, B, C, P (the owner's evening example)
    await moveEarlier(dialog, "X(2)", 4);
    await moveEarlier(dialog, "X(1)", 3);
    await moveEarlier(dialog, "B", 1);
    expect(await shownOrder(dialog)).toEqual(["X(2)", "X(1)", "A", "B", "C", "P"]);

    await dialog.getByRole("button", { name: "Start new shift" }).click();
    await expect(page.getByText("New shift started. The rotation starts at X(2).")).toBeVisible();
    expect(await currentRotation()).toEqual(["X-2", "X-1", "A", "B", "C", "P"]);
  });

  test("the floor follows it: first section first, and suggestions in that order", async ({ page }) => {
    await page.goto("/floor");
    const next = page.locator("section[aria-labelledby='new-party-heading'] p", { hasText: "Next in rotation" });
    await expect(next).toHaveText("Next in rotation: X(2)");
    await expect(page.locator("ol[aria-label='Seating rotation for this shift'] li")).toHaveText(["X(2)", "→X(1)", "→A", "→B", "→C", "→P"]);

    await page.fill("#party-guests", "3");
    await page.click("button:has-text('Find a table')");
    const suggestions = page.locator("ul li").filter({ hasText: "Seat here" });
    await expect(suggestions.nth(0)).toContainText("Section X(2)");
    await expect(suggestions.nth(1)).toContainText("Section X(1)");
    await expect(suggestions.nth(2)).toContainText("Section A");

    // Starting the shift left the group at A1 seated.
    await expect(page.locator("main button[aria-label^='A1,']")).toHaveAttribute("aria-label", /2 guests/);

    await seat(["X10"], 2); // seating in X(2) moves on to X(1), in this shift's order
    await expect(next).toHaveText("Next in rotation: X(1)", { timeout: env.realtime ? 4_000 : 15_000 });
  });

  test("changing it during the shift reaches other devices, and the next suggestion follows at once", async ({ page, browser }) => {
    const floor = await browser.newPage({ storageState: "e2e/.auth/admin.json" });
    await floor.goto("/floor");
    const list = floor.locator("ol[aria-label='Seating rotation for this shift'] li");
    await expect(list.first()).toHaveText("X(2)");

    await page.goto("/manage");
    await expect(editor(page)).toBeVisible();
    await moveEarlier(editor(page), "P", 5);
    expect(await shownOrder(editor(page))).toEqual(["P", "X(2)", "X(1)", "A", "B", "C"]);
    await page.selectOption("#rotation-next", "A");
    await page.click("button:has-text('Save rotation')");
    await expect(page.getByText("Rotation saved.")).toBeVisible();
    expect(await currentRotation()).toEqual(["P", "X-2", "X-1", "A", "B", "C"]);

    await expect(list.first()).toHaveText("P", { timeout: env.realtime ? 4_000 : 15_000 });
    await expect(floor.locator("section[aria-labelledby='new-party-heading'] p", { hasText: "Next in rotation" })).toHaveText("Next in rotation: A");
    await floor.fill("#party-guests", "3");
    await floor.click("button:has-text('Find a table')");
    const suggestions = floor.locator("ul li").filter({ hasText: "Seat here" });
    await expect(suggestions.nth(0)).toContainText("Section A");
    await expect(suggestions.nth(1)).toContainText("Section B");
    await floor.close();
  });

  test("a new shift begins at the first section of its own new order", async ({ page }) => {
    await page.goto("/manage");
    await page.click("section[aria-labelledby='shift-heading'] button:has-text('Start new shift')");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Put the sections in the order");
    await moveEarlier(dialog, "C", 5);
    expect((await shownOrder(dialog))[0]).toBe("C");
    await dialog.getByRole("button", { name: "Start new shift" }).click();
    await expect(page.getByText("New shift started. The rotation starts at C.")).toBeVisible();
    await page.goto("/floor");
    await expect(page.locator("section[aria-labelledby='new-party-heading'] p", { hasText: "Next in rotation" })).toHaveText("Next in rotation: C");
  });

  test.afterAll(async () => {
    await startShift(); // leave the default order for the other tests
    await freeTables(["A1", "X10"]);
  });
});
