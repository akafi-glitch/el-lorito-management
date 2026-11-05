import { expect, test, type Page } from "@playwright/test";

import { batchesOf, cancelOpenOrders, employee, finalizeTicket, openTicketsAt, printAttempts, saveOrder, setItem, startShift, ticketByNumber } from "./support/db";
import { answerNo, answerYes, lastReceipt, previews, printEvents, prints, stubPrinting, waitForPrint } from "./support/print";

/** Runs in Chromium and, in the "ipad-safari" project, in WebKit with an iPad's screen and browser name. */
const TABLE = "P3";
const question = (page: Page) => page.locator("dialog[open] h2");
const customerButton = (page: Page) => page.getByRole("button", { name: "Print Customer Receipt", exact: true });
const kitchenButton = (page: Page) => page.getByRole("button", { name: "Print Kitchen Receipt", exact: true });
const isIpad = (page: Page) => page.evaluate(() => /iPad/.test(navigator.userAgent));

test.describe.serial("printing, the way an iPad does it", () => {
  let waiter = 0;

  test.beforeAll(async () => {
    await startShift();
    waiter = await employee("01", "Kafi", "waiter");
    await setItem("Taco", 235, true);
  });

  test.beforeEach(async ({ page }) => {
    await cancelOpenOrders([TABLE]);
    await stubPrinting(page);
  });

  test.afterAll(async () => {
    await cancelOpenOrders([TABLE]);
  });

  test("the receipt is still on the page when the preview is built, long after print() returned", async ({ page }) => {
    const saved = await saveOrder(TABLE, waiter, [["Taco", 2]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await customerButton(page).click();
    await waitForPrint(page, 1);

    await expect.poll(async () => (await previews(page)).length, { timeout: 6000 }).toBe(1);
    const [preview] = await previews(page);
    expect(preview).toContain(`TICKET #${saved.ticket_number}`);
    expect(preview).toContain("2 × Taco");
    expect(preview).toBe(await lastReceipt(page));

    await page.emulateMedia({ media: "print" });
    const receipt = page.getByTestId("receipt");
    await expect(receipt).toBeVisible();
    expect(await receipt.evaluate((node) => (node as HTMLElement).style.width)).toBe("80mm");
    await expect(page.locator("main")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
  });

  test("on an iPad the print comes straight from a tap, so Safari has nothing to block", async ({ page }) => {
    await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await customerButton(page).click();
    if (await isIpad(page)) {
      await expect(question(page)).toHaveText("The receipt is ready");
      expect(await prints(page)).toBe(0); // not while waiting for the server: only after the tap
    }
    await waitForPrint(page, 1);
    if (await isIpad(page)) expect(await printEvents(page)).toEqual(["click"]);
    await expect(question(page)).toHaveText("Did the customer receipt print?");
  });

  test("opening the print dialog closes nothing: only Yes does", async ({ page }) => {
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await customerButton(page).click();
    await waitForPrint(page, 1);
    await expect(question(page)).toHaveText("Did the customer receipt print?");
    expect((await ticketByNumber(saved.ticket_number)).status).toBe("open");
    expect((await printAttempts(saved.ticket_id)).at(-1)?.outcome).toBe("unknown");

    await answerYes(page);
    await expect(page.getByText(`Ticket #${saved.ticket_number} is finalized.`)).toBeVisible();
    expect((await ticketByNumber(saved.ticket_number)).status).toBe("finalized");
    expect((await printAttempts(saved.ticket_id)).at(-1)?.outcome).toBe("printed");
  });

  test("No, then Print again, keeps the same ticket and prints the same bill", async ({ page }) => {
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await customerButton(page).click();
    await waitForPrint(page, 1);
    const first = await lastReceipt(page);

    await answerNo(page);
    await expect(question(page)).toHaveText("The customer receipt didn't print");
    expect((await ticketByNumber(saved.ticket_number)).status).toBe("open");
    expect((await printAttempts(saved.ticket_id)).at(-1)?.outcome).toBe("not_printed");

    await page.locator("dialog[open]").getByRole("button", { name: "Print again" }).click();
    await waitForPrint(page, 2);
    expect(await lastReceipt(page)).toContain(`TICKET #${saved.ticket_number}`);
    expect((await lastReceipt(page)).replace(/TIME: .*?(?=-|Taco|1 ×)/, "")).toBe(first.replace(/TIME: .*?(?=-|Taco|1 ×)/, ""));
    expect(await openTicketsAt(TABLE)).toHaveLength(1);

    await answerYes(page);
    expect(await openTicketsAt(TABLE)).toHaveLength(0);
    expect((await ticketByNumber(saved.ticket_number)).status).toBe("finalized");
  });

  test("leaving the question closes nothing", async ({ page }) => {
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await customerButton(page).click();
    await waitForPrint(page, 1);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect((await ticketByNumber(saved.ticket_number)).status).toBe("open");
    expect((await printAttempts(saved.ticket_id)).at(-1)?.outcome).toBe("unknown");
  });

  test("one tap is one print, and a kitchen order isn't marked sent until the waiter says so", async ({ page }) => {
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await kitchenButton(page).dblclick();
    await waitForPrint(page, 1);
    await page.waitForTimeout(500);
    expect(await prints(page)).toBe(1);
    expect(await printAttempts(saved.ticket_id, "kitchen")).toHaveLength(1);
    await expect(question(page)).toHaveText("Did the kitchen receipt print?");
    expect((await batchesOf(saved.ticket_id))[0]?.kitchen_printed_at).toBeNull();

    await answerYes(page);
    await expect(page.getByText("Sent to the kitchen. The order stays on the ticket.")).toBeVisible();
    expect((await batchesOf(saved.ticket_id))[0]?.kitchen_printed_at).not.toBeNull();
    await expect(page.locator("main")).toContainText("Kitchen Receipt Printed");
  });

  test("the Reprint Customer Receipt button: a copy, from a tap, that changes nothing", async ({ page }) => {
    const saved = await saveOrder(TABLE, waiter, [["Taco", 1]]);
    await finalizeTicket(saved.ticket_id, waiter);
    await page.goto(`/waiter/01/tables/${TABLE}?ticket=${saved.ticket_number}`);
    await page.getByRole("button", { name: "Reprint Customer Receipt" }).click();
    await waitForPrint(page, 1);
    if (await isIpad(page)) expect(await printEvents(page)).toEqual(["click"]);
    expect(await lastReceipt(page)).toContain("COPY");
    await expect(question(page)).toHaveText("Did the copy of the receipt print?");
    await answerYes(page);
    expect((await ticketByNumber(saved.ticket_number)).status).toBe("finalized");
    expect(await openTicketsAt(TABLE)).toHaveLength(0);
  });
});
