import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  auditFrom,
  cancelOpenOrders,
  clearPinAttempts,
  disableManagerPin,
  employee,
  finalizeTicket,
  MANAGER,
  saveOrder,
  setItem,
  setManagerPin,
  setPinSessionTimes,
  startShift,
} from "./support/db";
import { enterPin, unlock } from "./support/pin";

const PROTECTED = ["/manage/history", "/manage/shift-report"];
const gate = (page: Page) => page.locator("section[aria-labelledby='pin-heading']");
const bar = (page: Page) => page.getByTestId("pin-bar");
const alert = (page: Page) => page.locator("main [role=alert]");
const COOKIE = "el_lorito_pin";
const TABLE = "P5";

test.describe.serial("the PIN in front of Order History and the Shift Report", () => {
  let ticketNumber = 0;

  test.beforeAll(async () => {
    await startShift();
    await setManagerPin(MANAGER.number, MANAGER.pin);
    await clearPinAttempts();
    const waiter = await employee("01", "Kafi", "waiter");
    await setItem("Taco", 235, true);
    await cancelOpenOrders([TABLE]);
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await finalizeTicket(saved.ticket_id, waiter);
    ticketNumber = saved.ticket_number;
  });

  test.afterEach(async () => {
    await clearPinAttempts();
  });

  test("typing the address shows the PIN screen, and none of the data", async ({ page }) => {
    for (const path of [...PROTECTED, `/manage/history/${ticketNumber}`]) {
      const response = await page.goto(path);
      await expect(gate(page)).toBeVisible();
      const html = await response!.text();
      expect(html, path).not.toContain(`#${ticketNumber}`);
      expect(html, path).not.toContain("history-row");
      expect(html, path).not.toContain("shift-total");
      await expect(page.getByTestId("history-row")).toHaveCount(0);
      await expect(page.getByTestId("report-row")).toHaveCount(0);
    }
  });

  test("the rest of the app needs no PIN", async ({ page }) => {
    for (const path of ["/", "/floor", "/waiter", "/waiter/01", `/waiter/01/tables/${TABLE}`, "/manage", "/manage/employees", "/manage/menu"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expect(gate(page), path).toHaveCount(0);
    }
  });

  test("the PIN screen is easy to use by touch, hides the digits, and passes the accessibility check", async ({ page }) => {
    await page.goto("/manage/history");
    await expect(gate(page)).toBeVisible();
    for (const digit of MANAGER.number) await gate(page).getByRole("button", { name: digit, exact: true }).click();
    await expect(page.locator("#pin-employee")).toHaveValue(MANAGER.number);
    await gate(page).getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.locator("#pin-value")).toHaveAttribute("type", "password");
    await expect(gate(page).getByRole("button", { name: "Unlock", exact: true })).toBeDisabled();
    await gate(page).getByRole("button", { name: "7", exact: true }).click();
    await expect(page.locator("#pin-value")).toHaveValue("7");
    await expect(gate(page).getByRole("button", { name: "Unlock", exact: true })).toBeDisabled(); // fewer than 6 digits

    const box = await gate(page).getByRole("button", { name: "7", exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("a wrong PIN and an unknown number get the same words, and both are in the history", async ({ page }) => {
    const since = new Date().toISOString();
    await page.goto("/manage/history");
    await enterPin(page, MANAGER.number, "111222");
    await expect(alert(page)).toHaveText("Incorrect PIN");
    await expect(bar(page)).toHaveCount(0);

    await page.goto("/manage/history");
    await enterPin(page, "998877", "111222");
    await expect(alert(page)).toHaveText("Incorrect PIN");

    const failed = (await auditFrom(since)).filter((event) => event.event_type === "pin_failed");
    expect(failed.map((event) => event.details.employee_number)).toEqual([MANAGER.number, null]);
    expect(JSON.stringify(failed)).not.toContain("111222");
  });

  test("an employee without a PIN can't open these areas", async ({ page }) => {
    await page.goto("/manage/history");
    await enterPin(page, "01", MANAGER.pin); // a waiter, with a real manager's PIN
    await expect(alert(page)).toHaveText("Incorrect PIN");
    await expect(bar(page)).toHaveCount(0);
  });

  test("the right PIN opens it with a protected cookie, and nothing secret reaches the browser", async ({ page, context }) => {
    const since = new Date().toISOString();
    await page.goto("/manage/shift-report");
    await enterPin(page, MANAGER.number, MANAGER.pin);
    await expect(bar(page)).toContainText(`Test Manager (${MANAGER.number})`);
    await expect(page.getByTestId("shift-total")).toBeVisible();

    const cookie = (await context.cookies()).find((candidate) => candidate.name === COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.secure).toBe(true); // the tests run the production build
    expect(cookie.value.split(".")).toHaveLength(2);
    expect(cookie.value).not.toContain(MANAGER.pin);
    expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);

    const html = await page.content();
    expect(html).not.toContain(MANAGER.pin);
    expect(html).not.toMatch(/\$2[aby]\$/);
    expect(html).not.toMatch(/sb_secret/);

    // One unlock opens both areas, and a ticket.
    await page.goto("/manage/history");
    await expect(page.getByTestId("history-row").first()).toBeVisible();
    await page.goto(`/manage/history/${ticketNumber}`);
    await expect(bar(page)).toBeVisible();
    await expect(page.locator("main")).toContainText(`Ticket #${ticketNumber}`);

    const events = await auditFrom(since);
    expect(events.filter((event) => event.event_type === "pin_login").map((event) => event.details.employee_number)).toEqual([MANAGER.number]);
  });

  test("a changed cookie gets the PIN screen", async ({ page, context }) => {
    await unlock(page, "/manage/history");
    const cookie = (await context.cookies()).find((candidate) => candidate.name === COOKIE)!;
    await context.addCookies([{ ...cookie, value: `x${cookie.value}` }]);
    await page.goto("/manage/history");
    await expect(gate(page)).toBeVisible();
    await expect(page.getByTestId("history-row")).toHaveCount(0);
  });

  test("Lock ends it at once and goes Home; Back doesn't bring the data back", async ({ page, context }) => {
    const since = new Date().toISOString();
    await unlock(page, "/manage/history");
    const before = (await context.cookies()).find((candidate) => candidate.name === COOKIE)!;
    await bar(page).getByRole("button", { name: "Lock", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await context.cookies()).some((candidate) => candidate.name === COOKIE)).toBe(false);

    await page.goBack();
    await expect(gate(page)).toBeVisible();
    await expect(page.getByTestId("history-row")).toHaveCount(0);

    // The old cookie is no use either: the session ended on the server.
    await context.addCookies([before]);
    await page.goto("/manage/shift-report");
    await expect(gate(page)).toBeVisible();

    const events = await auditFrom(since);
    expect(events.filter((event) => event.event_type === "pin_locked").map((event) => event.details.employee_number)).toEqual([MANAGER.number]);
  });

  test("after 5 wrong PINs it locks for 10 minutes, even for the right PIN, and that is in the history", async ({ page }) => {
    const since = new Date().toISOString();
    await page.goto("/manage/history");
    await enterPin(page, MANAGER.number, "111222");
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await expect(alert(page)).toHaveText("Incorrect PIN");
      await page.fill("#pin-value", "111222");
      await gate(page).getByRole("button", { name: "Unlock", exact: true }).click();
      await expect(gate(page).getByRole("button", { name: "Unlock", exact: true })).toBeDisabled();
    }
    await expect(alert(page)).toHaveText("Incorrect PIN");
    await page.fill("#pin-value", "111222");
    await gate(page).getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(alert(page)).toHaveText("Too many attempts. Try again in 10 minutes.");

    await page.goto("/manage/history");
    await enterPin(page, MANAGER.number, MANAGER.pin);
    await expect(alert(page)).toHaveText("Too many attempts. Try again in 10 minutes.");
    await expect(bar(page)).toHaveCount(0);

    // A browser can't get around it: the count isn't kept there.
    const fresh = await page.context().browser()!.newContext({ storageState: "e2e/.auth/admin.json" });
    const other = await fresh.newPage();
    await other.goto(new URL("/manage/history", page.url()).toString());
    await enterPin(other, MANAGER.number, MANAGER.pin);
    await expect(alert(other)).toHaveText("Too many attempts. Try again in 10 minutes.");
    await fresh.close();

    const events = await auditFrom(since);
    expect(events.filter((event) => event.event_type === "pin_failed")).toHaveLength(5);
    expect(events.filter((event) => event.event_type === "pin_lockout").map((event) => event.details.employee_number)).toEqual([MANAGER.number]);

    // Once it's over, the right PIN works.
    await clearPinAttempts();
    await page.goto("/manage/history");
    await enterPin(page, MANAGER.number, MANAGER.pin);
    await expect(bar(page)).toBeVisible();
  });

  test("15 minutes idle locks it, 12 hours locks it however busy, and real use keeps it open", async ({ page }) => {
    await unlock(page, "/manage/history");
    await setPinSessionTimes({ lastSeenMinutesAgo: 16 });
    await page.reload();
    await expect(gate(page)).toBeVisible();

    await enterPin(page, MANAGER.number, MANAGER.pin);
    await expect(bar(page)).toBeVisible();
    await setPinSessionTimes({ expiresMinutesAgo: 1 });
    await page.reload();
    await expect(gate(page)).toBeVisible();

    await enterPin(page, MANAGER.number, MANAGER.pin);
    await expect(bar(page)).toBeVisible();
    await setPinSessionTimes({ lastSeenMinutesAgo: 14 });
    await page.reload(); // opening the page counts as being there
    await expect(bar(page)).toBeVisible();
    await expect.poll(async () => (await setPinSessionTimes({})).lastSeenMinutesAgo).toBeLessThan(1);
  });

  test("a page left open locks itself when time is up", async ({ page }) => {
    await page.clock.install();
    await unlock(page, "/manage/history");
    await expect(page.getByTestId("history-row").first()).toBeVisible();
    await setPinSessionTimes({ lastSeenMinutesAgo: 16 });
    await page.clock.fastForward(16 * 60 * 1000);
    await expect(gate(page)).toBeVisible();
    await expect(page.getByTestId("history-row")).toHaveCount(0);
  });

  test("turning a PIN off, or changing it, ends access at once", async ({ page }) => {
    await unlock(page, "/manage/history");
    await setManagerPin(MANAGER.number, "739164");
    await page.reload();
    await expect(gate(page)).toBeVisible();
    await enterPin(page, MANAGER.number, MANAGER.pin);
    await expect(alert(page)).toHaveText("Incorrect PIN"); // the old one no longer works

    await page.goto("/manage/history");
    await enterPin(page, MANAGER.number, "739164");
    await expect(bar(page)).toBeVisible();
    await disableManagerPin(MANAGER.number);
    await page.reload();
    await expect(gate(page)).toBeVisible();
    await enterPin(page, MANAGER.number, "739164");
    await expect(alert(page)).toHaveText("Incorrect PIN");

    await setManagerPin(MANAGER.number, MANAGER.pin); // back as the other tests expect
  });

  test("signing out of the app ends it too", async ({ browser }) => {
    // Its own sign-in: signing out must not end the one the other tests share.
    const context = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
    const page = await context.newPage();
    await unlock(page, "/manage/history");
    const before = (await context.cookies()).find((candidate) => candidate.name === COOKIE)!;
    const since = new Date().toISOString();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    expect((await context.cookies()).some((candidate) => candidate.name === COOKIE)).toBe(false);
    const events = await auditFrom(since);
    expect(events.filter((event) => event.event_type === "pin_locked")).toHaveLength(1);
    expect(before.value).toBeTruthy();
    await context.close();
  });
});
