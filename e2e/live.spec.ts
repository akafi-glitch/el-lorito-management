import { expect, test } from "@playwright/test";

import { assign, employee, freeTables, seat, setItem, startShift } from "./support/db";
import { testEnv } from "./support/env";

/**
 * Two screens stay in step. Where Supabase Realtime runs (CI: E2E_REALTIME=1) the live connection
 * itself is checked: the dot must say "Live", and while it does the screen never polls, so an
 * update can only have come through Realtime. Elsewhere the 5-second fallback is checked instead.
 */
test.describe.serial("live updates across devices", () => {
  const env = testEnv();

  test.beforeAll(async () => {
    await freeTables(["A4", "C5"]);
    await setItem("Lunch #4 (Taco Salad)", 749, true);
  });

  test("seating on one device shows on another floor without reloading", async ({ page }) => {
    await page.goto("/floor");
    const dot = page.getByTestId("live-status");
    if (env.realtime) await expect(dot).toHaveText("Live", { timeout: 20_000 });
    await expect(page.locator("main button[aria-label^='A4,']")).toHaveAttribute("aria-label", /Vacant/);
    const started = Date.now();
    await seat(["A4"], 5);
    await expect(page.locator("main button[aria-label^='A4,']")).toHaveAttribute("aria-label", /5 guests/, { timeout: env.realtime ? 4_000 : 15_000 });
    test.info().annotations.push({ type: "update time", description: `${Date.now() - started} ms` });
    if (env.realtime) await expect(dot).toHaveText("Live");
  });

  test("the floor on a second browser follows the first", async ({ page, browser }) => {
    const other = await browser.newPage({ storageState: "e2e/.auth/admin.json" });
    await page.goto("/floor");
    await other.goto("/floor");
    if (env.realtime) await expect(other.getByTestId("live-status")).toHaveText("Live", { timeout: 20_000 });
    await page.fill("#party-guests", "");
    await page.locator("main button[aria-label^='C5,']").click();
    await page.fill("#tray-guests", "2");
    await page.click("[aria-label='Seat selected tables'] button[type=submit]");
    await expect(page.getByText("Seated 2 guests at C5.")).toBeVisible();
    await expect(other.locator("main button[aria-label^='C5,']")).toHaveAttribute("aria-label", /2 guests/, { timeout: env.realtime ? 4_000 : 15_000 });
    await other.close();
  });

  test("a reassignment and a menu change reach the waiter's screens", async ({ page }) => {
    await startShift();
    const kafi = await employee("01", "Kafi", "waiter");
    await assign("X-1", "waiter", kafi);
    await page.goto("/waiter/01");
    await expect(page.locator("main")).toContainText("Your section: X(1)");
    await assign("A", "waiter", kafi);
    await expect(page.locator("main")).toContainText("Your sections: A, X(1)");

    await seat(["A4"], 2);
    await page.goto("/waiter/01/tables/A4");
    await page.click("nav[aria-label='Menu categories'] button:text-is('Lunch')");
    await setItem("Lunch #4 (Taco Salad)", 749, false);
    await expect(page.locator("button[aria-label^='Add Lunch #4 (Taco Salad),']")).toBeDisabled();
    await setItem("Lunch #4 (Taco Salad)", 749, true);
    await expect(page.locator("button[aria-label^='Add Lunch #4 (Taco Salad),']")).toBeEnabled();
  });

  test("a new shift started on one device puts the rotation back at A on another floor", async ({ page, browser }) => {
    await startShift();
    await seat(["C5"], 2); // seating in C moves the rotation to B
    await page.goto("/floor");
    if (env.realtime) await expect(page.getByTestId("live-status")).toHaveText("Live", { timeout: 20_000 });
    const next = page.locator("section[aria-labelledby='new-party-heading'] p", { hasText: "Next in rotation" });
    await expect(next).toHaveText("Next in rotation: B");

    const manager = await browser.newPage({ storageState: "e2e/.auth/admin.json" });
    await manager.goto("/manage");
    await manager.click("section[aria-labelledby='shift-heading'] button:has-text('Start new shift')");
    await manager.locator("dialog").getByRole("button", { name: "Start new shift" }).click();
    await expect(manager.getByText("New shift started. The rotation starts at A.")).toBeVisible();

    await expect(next).toHaveText("Next in rotation: A", { timeout: env.realtime ? 4_000 : 15_000 });
    await expect(page.locator("main button[aria-label^='C5,']")).toHaveAttribute("aria-label", /2 guests/);
    await manager.close();
  });

  test("losing the connection is shown, and changes made meanwhile appear when it's back", async ({ page, context }) => {
    await page.goto("/floor");
    await context.setOffline(true);
    await expect(page.getByTestId("live-status")).toHaveText(/Offline|Reconnecting/, { timeout: 20_000 });
    await freeTables(["A4"]);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("main button[aria-label^='A4,']")).toHaveAttribute("aria-label", /Vacant/);
  });
});
