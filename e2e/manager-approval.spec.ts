import { expect, test, type Page } from "@playwright/test";

import { auditFrom, batchesOf, cancelOpenOrders, clearPinAttempts, employee, MANAGER, openTicketsAt, saveOrder, setItem, setManagerPin, startShift, ticketByNumber } from "./support/db";
import { answerYes, stubPrinting, waitForPrint } from "./support/print";

const TABLE = "P4";
const approval = (page: Page) => page.getByTestId("manager-approval");
const alert = (page: Page) => approval(page).locator("[role=alert]");
const saved = (page: Page) => page.locator("section[aria-labelledby='saved-ticket-heading']");

/** Saves an order and prints it for the kitchen, through the screens. */
async function orderAndPrint(page: Page, waiter: number) {
  await saveOrder(TABLE, waiter, [["Taco", 3], ["Horchata", 1]]);
  await stubPrinting(page);
  await page.goto(`/waiter/01/tables/${TABLE}`);
  await page.getByRole("button", { name: "Print Kitchen Receipt", exact: true }).click();
  await waitForPrint(page, 1);
  await answerYes(page);
  await expect(page.getByText("Sent to the kitchen. The order stays on the ticket.")).toBeVisible();
  await expect(page.locator("main")).toContainText("Kitchen Receipt Printed");
}

async function givePin(page: Page, number: string, pin: string, confirm: string) {
  await page.fill("#approval-number", number);
  await approval(page).getByRole("button", { name: "Next", exact: true }).click();
  await page.fill("#approval-pin", pin);
  await approval(page).getByRole("button", { name: confirm, exact: true }).click();
}

test.describe.serial("a manager's PIN to take anything off an order the kitchen has", () => {
  let waiter = 0;

  test.beforeAll(async () => {
    await startShift();
    await setManagerPin(MANAGER.number, MANAGER.pin);
    waiter = await employee("01", "Kafi", "waiter");
    await setItem("Taco", 235, true);
    await setItem("Horchata", 325, true);
  });

  test.beforeEach(async () => {
    await clearPinAttempts();
    await cancelOpenOrders([TABLE]);
  });

  test.afterAll(async () => {
    await clearPinAttempts();
    await cancelOpenOrders([TABLE]);
  });

  test("before the kitchen has it, a waiter changes it alone", async ({ page }) => {
    await saveOrder(TABLE, waiter, [["Taco", 3], ["Horchata", 1]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await page.click("button[aria-label='One fewer saved Taco']");
    await expect(saved(page)).toContainText("2 × Taco");
    await page.click("button[aria-label='Remove saved Horchata']");
    await page.locator("dialog[open]").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(saved(page)).not.toContainText("Horchata");
    await expect(approval(page)).toHaveCount(0);
  });

  test("after printing, removing an item asks for a manager, and a wrong PIN changes nothing", async ({ page }) => {
    await orderAndPrint(page, waiter);
    await page.click("button[aria-label='Remove saved Taco']");
    await expect(page.locator("dialog[open] h2")).toHaveText("Remove Taco?");
    await expect(page.locator("#approval-pin")).toHaveCount(0);

    await givePin(page, MANAGER.number, "111222", "Approve and remove");
    await expect(alert(page)).toHaveText("Incorrect PIN");
    await expect(page.locator("#approval-pin")).toHaveValue("");
    const [ticket] = await openTicketsAt(TABLE);
    expect((await batchesOf(ticket!.id))[0]?.ticket_lines.map((line) => line.item_name)).toContain("Taco");

    // A waiter's number doesn't work either, and reads the same.
    await page.getByRole("button", { name: "Keep it" }).click();
    await page.click("button[aria-label='Remove saved Taco']");
    await givePin(page, "01", MANAGER.pin, "Approve and remove");
    await expect(alert(page)).toHaveText("Incorrect PIN");
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(saved(page)).toContainText("3 × Taco");
  });

  test("the right PIN removes it, and the history names the manager", async ({ page }) => {
    await orderAndPrint(page, waiter);
    const since = new Date().toISOString();
    await page.click("button[aria-label='Remove saved Taco']");
    await givePin(page, MANAGER.number, MANAGER.pin, "Approve and remove");
    await expect(page.getByText("Taco removed. Tell the kitchen.")).toBeVisible();
    await expect(saved(page)).not.toContainText("Taco");
    await expect(saved(page)).toContainText("Horchata");

    const events = await auditFrom(since);
    expect(events.filter((event) => event.event_type === "pin_approved").map((event) => event.details.employee_number)).toEqual([MANAGER.number]);
    expect(events.find((event) => event.event_type === "ticket_changed")?.details.approved_by).toBe(MANAGER.number);
    expect(JSON.stringify(events)).not.toContain(MANAGER.pin);
  });

  test("lowering a quantity needs it too, and a printed line has no + button", async ({ page }) => {
    await orderAndPrint(page, waiter);
    await expect(page.locator("button[aria-label='One more saved Taco']")).toHaveCount(0);
    await page.click("button[aria-label='One fewer saved Taco']");
    await expect(page.locator("dialog[open] h2")).toHaveText("Take one Taco off?");
    await expect(saved(page)).toContainText("3 × Taco");
    await givePin(page, MANAGER.number, MANAGER.pin, "Approve");
    await expect(saved(page)).toContainText("2 × Taco");
  });

  test("a waiter adds food and liquor alone after printing, and the new order changes freely", async ({ page }) => {
    await orderAndPrint(page, waiter);
    await page.fill("#menu-search", "domestic");
    await page.locator("button[aria-label^='Add Domestic beer,']").first().click();
    await page.getByRole("button", { name: "Save Order", exact: true }).click();
    await expect(saved(page).getByTestId("order-2")).toContainText("Domestic beer");
    await expect(approval(page)).toHaveCount(0);

    await page.click("button[aria-label='One more saved Domestic beer']");
    await expect(saved(page).getByTestId("order-2")).toContainText("2 × Domestic beer");
    await page.click("button[aria-label='Remove saved Domestic beer']");
    await expect(page.locator("dialog[open] h2")).toHaveText("Remove Domestic beer?");
    await expect(approval(page)).toHaveCount(0); // not sent to the kitchen yet
    await page.locator("dialog[open]").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(saved(page)).not.toContainText("Domestic beer");
  });

  test("cancelling a ticket the kitchen has needs it too", async ({ page }) => {
    await orderAndPrint(page, waiter);
    const [ticket] = await openTicketsAt(TABLE);
    await page.getByRole("button", { name: "Cancel this ticket" }).click();
    await expect(page.locator("dialog[open] h2")).toHaveText(`Cancel ticket #${ticket!.ticket_number}?`);
    await givePin(page, MANAGER.number, MANAGER.pin, "Approve and cancel");
    await expect(page.getByText(`Ticket #${ticket!.ticket_number} cancelled. Tell the kitchen.`)).toBeVisible();
    expect((await ticketByNumber(ticket!.ticket_number)).status).toBe("cancelled");
  });

  test("5 wrong PINs lock it, the same as the PIN screen", async ({ page }) => {
    await orderAndPrint(page, waiter);
    await page.click("button[aria-label='Remove saved Taco']");
    await givePin(page, MANAGER.number, "111222", "Approve and remove");
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await expect(alert(page)).toHaveText("Incorrect PIN");
      await page.fill("#approval-pin", "111222");
      await approval(page).getByRole("button", { name: "Approve and remove", exact: true }).click();
      if (attempt < 5) await expect(approval(page).getByRole("button", { name: "Approve and remove", exact: true })).toBeDisabled();
    }
    await expect(alert(page)).toHaveText("Too many attempts. Try again in 10 minutes.");
    await page.fill("#approval-pin", MANAGER.pin);
    await approval(page).getByRole("button", { name: "Approve and remove", exact: true }).click();
    await expect(alert(page)).toHaveText("Too many attempts. Try again in 10 minutes.");
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(saved(page)).toContainText("3 × Taco");
  });
});
