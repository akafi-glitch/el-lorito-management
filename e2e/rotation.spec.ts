import { expect, test, type Locator, type Page } from "@playwright/test";

import { currentRotation, finishShift, freeTables, seat, startShift } from "./support/db";
import { testEnv } from "./support/env";

const editor = (page: Page) => page.locator("section[aria-labelledby='rotation-heading']");
// By the number each row shows: during a drag the rows only look reordered.
const shownOrder = async (where: Locator) => {
  await expect(where.getByTestId("rotation-row").first()).toBeVisible();
  return where.getByTestId("rotation-row").evaluateAll((rows) =>
    rows
      .map((row) => ({ place: Number(row.children[0]!.textContent), name: row.children[1]!.textContent!.trim() }))
      .sort((a, b) => a.place - b.place)
      .map((row) => row.name),
  );
};
const handle = (where: Locator, name: string) => where.getByRole("button", { name: `Move ${name}`, exact: true });
const moveEarlier = async (where: Locator, name: string, times: number) => {
  await handle(where, name).focus();
  for (let i = 0; i < times; i += 1) await handle(where, name).press("ArrowUp");
};
const middleOf = async (where: Locator) => {
  await expect(where).toBeVisible();
  const box = (await where.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const rowOf = (where: Locator, name: string) => where.getByTestId("rotation-row").filter({ hasText: new RegExp(`\\d${name.replace(/[()]/g, "\\$&")}$`) });

test.describe.serial("the manager's seating rotation", () => {
  const env = testEnv();

  test.beforeAll(async () => {
    await startShift();
    await freeTables(["A1", "A2", "X1", "X4", "X10", "X11", "P1"]);
  });

  test("starting a shift shows the sections to arrange, and saves the order", async ({ page }) => {
    await seat(["A1"], 2); // someone is seated across the shift change
    await finishShift();
    await page.goto("/manage");
    await page.click("section[aria-labelledby='shift-heading'] button:has-text('Start shift')");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Drag the sections into the order");
    expect(await shownOrder(dialog)).toEqual(["A", "C", "B", "X(1)", "X(2)", "P"]);

    // A, C, B, X(1), X(2), P -> X(2), X(1), A, B, C, P (the owner's evening example)
    await moveEarlier(dialog, "X(2)", 4);
    await moveEarlier(dialog, "X(1)", 3);
    await moveEarlier(dialog, "B", 1);
    expect(await shownOrder(dialog)).toEqual(["X(2)", "X(1)", "A", "B", "C", "P"]);

    await dialog.getByRole("button", { name: "Start shift" }).click();
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
    await finishShift();
    await page.goto("/manage");
    await page.click("section[aria-labelledby='shift-heading'] button:has-text('Start shift')");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Drag the sections into the order");
    await moveEarlier(dialog, "C", 1); // a shift starts from the default order: A, C, B, ...
    expect((await shownOrder(dialog))[0]).toBe("C");
    await dialog.getByRole("button", { name: "Start shift" }).click();
    await expect(page.getByText("New shift started. The rotation starts at C.")).toBeVisible();
    await page.goto("/floor");
    await expect(page.locator("section[aria-labelledby='new-party-heading'] p", { hasText: "Next in rotation" })).toHaveText("Next in rotation: C");
  });

  test("dragging a section with the mouse puts it straight where it's dropped", async ({ page }) => {
    await startShift();
    await page.goto("/manage");
    const list = editor(page);
    expect(await shownOrder(list)).toEqual(["A", "C", "B", "X(1)", "X(2)", "P"]);

    // P, from last place, onto second place, in one drag.
    await rowOf(list, "P").scrollIntoViewIfNeeded();
    const from = await middleOf(rowOf(list, "P"));
    const to = await middleOf(rowOf(list, "C"));
    await page.mouse.move(from.x - 100, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x - 100, to.y, { steps: 12 });
    await expect.poll(() => shownOrder(list), { message: "the list follows the drag" }).toEqual(["A", "P", "C", "B", "X(1)", "X(2)"]);
    await page.mouse.up();
    await expect.poll(() => shownOrder(list)).toEqual(["A", "P", "C", "B", "X(1)", "X(2)"]);

    await page.click("button:has-text('Save rotation')");
    await expect(page.getByText("Rotation saved.")).toBeVisible();
    expect(await currentRotation()).toEqual(["A", "P", "C", "B", "X-1", "X-2"]);
  });

  test("a finger drags from the handle, and swiping over a row doesn't move anything", async ({ browser }) => {
    await startShift();
    const context = await browser.newContext({ storageState: "e2e/.auth/admin.json", hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
    const page = await context.newPage();
    await page.goto("/manage");
    const list = editor(page);
    await expect(list).toBeVisible();
    await list.scrollIntoViewIfNeeded();
    const touch = await context.newCDPSession(page);
    const finger = async (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
      touch.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [at] : [] });

    await expect(rowOf(list, "B")).toBeVisible();
    const box = (await rowOf(list, "B").boundingBox())!;
    await finger("touchStart", { x: box.x + 90, y: box.y + box.height / 2 });
    await finger("touchMove", { x: box.x + 90, y: box.y - 100 });
    await finger("touchEnd");
    expect(await shownOrder(list), "a swipe over the row").toEqual(["A", "C", "B", "X(1)", "X(2)", "P"]);
    await list.scrollIntoViewIfNeeded(); // the swipe scrolled the page

    const from = await middleOf(handle(list, "B"));
    const to = await middleOf(handle(list, "A"));
    await finger("touchStart", from);
    for (let step = 1; step <= 8; step += 1) await finger("touchMove", { x: from.x, y: from.y + ((to.y - from.y) * step) / 8 });
    await finger("touchEnd");
    await expect.poll(() => shownOrder(list), { message: "a drag from the handle" }).toEqual(["B", "A", "C", "X(1)", "X(2)", "P"]);
    await context.close();
  });

  test("the keyboard moves a section one place at a time, and stops at either end", async ({ page }) => {
    await startShift();
    await page.goto("/manage");
    const list = editor(page);
    await expect(handle(list, "C")).toBeVisible();
    await handle(list, "C").focus();
    await page.keyboard.press("ArrowUp");
    await expect(handle(list, "C")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => shownOrder(list)).toEqual(["C", "A", "B", "X(1)", "X(2)", "P"]);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => shownOrder(list)).toEqual(["A", "C", "B", "X(1)", "X(2)", "P"]);
    await expect(list.locator("p[aria-live]")).toHaveText("C is now number 2.");
  });

  test.afterAll(async () => {
    await startShift(); // leave the default order for the other tests
    await freeTables(["A1", "X10"]);
  });
});
