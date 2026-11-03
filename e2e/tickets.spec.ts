import { devices, expect, test, type Page } from "@playwright/test";

import { batchesOf, cancelOpenOrders, employee, freeTables, openTicketsAt, printAttempts, saveOrder, setItem, setTaxRate, startShift, ticketByNumber, ticketTotal } from "./support/db";

const item = (page: Page, name: string) => page.locator(`button[aria-label^='Add ${name},']`).first();
const category = (page: Page, name: string) => page.click(`nav[aria-label='Menu categories'] button:text-is('${name}')`);
const order = (page: Page) => page.locator("#current-order");
const saved = (page: Page) => page.locator("section[aria-labelledby='saved-ticket-heading']");
const saveOrderButton = (page: Page) => page.getByRole("button", { name: "Save Order", exact: true });
const kitchenButton = (page: Page) => page.getByRole("button", { name: "Print Kitchen Receipt", exact: true });
const customerButton = (page: Page) => page.getByRole("button", { name: "Print Customer Receipt", exact: true });

/** The browser's print dialog can't be driven in a test: count the calls and keep the receipt text. */
async function stubPrinting(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: number; __receipts: string[]; print: () => void };
    w.__prints = 0;
    w.__receipts = [];
    w.print = () => {
      w.__prints += 1;
      w.__receipts.push(document.querySelector(".receipt-print")?.textContent ?? "");
    };
  });
}
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);
const lastReceipt = (page: Page) => page.evaluate(() => (window as unknown as { __receipts: string[] }).__receipts.at(-1) ?? "");
const answerYes = (page: Page) => page.click("dialog[open] button:has-text('Yes, it printed')");
const BLUE = "rgb(29, 78, 216)";
const GREEN = "rgb(21, 128, 61)";

/** A table's button in the waiter's list. */
async function tableInList(page: Page, section: string, code: string) {
  await page.goto("/waiter/01");
  await page.selectOption("#pick-section", { label: section });
  return page.locator("nav[aria-labelledby='pick-table-heading'] a", { hasText: code });
}
const answerNo = (page: Page) => page.click("dialog[open] button:has-text('No, it didn')");

async function ticketNumberOnScreen(page: Page): Promise<number> {
  const heading = page.locator("#saved-ticket-heading");
  await expect(heading).toBeVisible();
  return Number((await heading.textContent())!.match(/#(\d+)/)![1]);
}

test.describe.serial("orders on a phone", () => {
  const phone = devices["Pixel 7"];
  test.use({ viewport: phone.viewport, userAgent: phone.userAgent, hasTouch: true, isMobile: true });

  let kafi = 0;
  const table = "X9";

  test.beforeAll(async () => {
    await startShift();
    kafi = await employee("01", "Kafi", "waiter");
    await employee("02", "Musfika", "waiter");
    await setItem("Combo #5", 940, true);
    await setItem("Domestic beer", 499, true);
    await setItem("Taco", 235, true);
    await freeTables([table]); // nobody is seated: ordering doesn't need the Floor
    await cancelOpenOrders([table]);
  });

  test.afterAll(async () => {
    await cancelOpenOrders([table]);
  });

  test("the whole path from a phone: number, section, table, order, save", async ({ page }) => {
    await page.goto("/waiter");
    await page.tap("[aria-label='Number pad'] button:text-is('1')");
    await page.tap("button:has-text('Show my tables')");
    await page.selectOption("#pick-section", { label: "X(1)" });
    await page.getByRole("link", { name: table, exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`/waiter/01/tables/${table}$`));

    await expect(page.locator("nav[aria-label='Menu categories'] button")).toHaveCount(26);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await category(page, "Combination Dinners");
    await item(page, "Combo #5").tap();
    await item(page, "Combo #5").tap();
    await page.fill("#menu-search", "domestic");
    await item(page, "Domestic beer").tap();
    await page.fill("#menu-search", "chile con queso");
    await item(page, "Chile con queso").tap();
    await page.tap("button[aria-label='Remove Chile con queso']");
    await expect(order(page)).not.toContainText("Chile con queso");

    // $18.80 food + $4.99 beer -> $1.60 + $0.52 tax -> $25.91
    for (const part of ["Food subtotal$18.80", "Liquor subtotal$4.99", "Food tax (8.5%)$1.60", "Liquor tax (10.5%)$0.52", "Total$25.91"]) {
      await expect(order(page)).toContainText(part, { useInnerText: false });
    }

    // Each item has its own note, not only the last one.
    await order(page).getByLabel("Note for Combo #5").fill("Extra rice");
    await order(page).getByLabel("Note for Domestic beer").fill("No glass");
    await page.fill("#order-notes", "No onions");
    await saveOrderButton(page).tap();
    await expect(page.getByText(/Order saved on ticket #\d+\./)).toBeVisible();
    const number = await ticketNumberOnScreen(page);
    expect(await ticketTotal(number)).toBe(2591);
    await expect(saved(page).getByTestId("ticket-total")).toHaveText("$25.91");
    await expect(order(page)).not.toContainText("Combo #5"); // the new-order panel is empty again
    await expect(page.locator("#order-notes")).toHaveValue("");

    const ticket = await ticketByNumber(number);
    expect(ticket.employee_id).toBe(kafi);
    expect(ticket.status).toBe("open");
    const [batch] = await batchesOf(ticket.id);
    expect(batch?.notes).toBe("No onions");
    expect(batch?.employee_id).toBe(kafi);
    expect(batch?.ticket_lines.map((l) => [l.item_name, l.quantity, l.unit_price_cents])).toEqual([
      ["Combo #5", 2, 940],
      ["Domestic beer", 1, 499],
    ]);
    expect(batch?.ticket_lines.map((l) => l.notes)).toEqual(["Extra rice", "No glass"]);
    expect(await printAttempts(ticket.id, "kitchen")).toEqual([]); // saving doesn't print
  });

  test("returning to the table shows everything saved, with the taxes", async ({ page }) => {
    await page.goto(`/waiter/02/tables/${table}`); // any waiter can pick it up
    const panel = saved(page);
    await expect(panel).toContainText("2 × Combo #5");
    await expect(panel).toContainText("1 × Domestic beer");
    await expect(panel).toContainText("Note: No onions");
    await expect(panel.getByText("Note: Extra rice")).toBeVisible();
    await expect(panel.getByText("Note: No glass")).toBeVisible();
    for (const part of ["Food subtotal$18.80", "Liquor subtotal$4.99", "Food tax (8.5%)$1.60", "Liquor tax (10.5%)$0.52", "Total$25.91"]) {
      await expect(panel).toContainText(part, { useInnerText: false });
    }
    await expect(page.getByRole("link", { name: "Add more items" })).toBeVisible();
    await expect(customerButton(page)).toBeVisible();
    await expect(page.getByTestId("order-1")).toContainText("Waiter 01");
  });

  test("a custom item is checked, saved with its own tax, and stays off the menu", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${table}`);
    await page.tap("button:has-text('Add Custom Item')");
    await page.fill("#custom-name", "House tequila shot");
    await page.fill("#custom-price", "7.00");
    await page.fill("#custom-quantity", "2");
    await page.tap("dialog[open] button:has-text('Add to order')");
    await expect(page.locator("dialog[open] [role=alert]")).toContainText("tax type"); // never guessed
    await page.selectOption("#custom-tax", "cocktail");
    await page.fill("#custom-price", "-1");
    await page.tap("dialog[open] button:has-text('Add to order')");
    await expect(page.locator("dialog[open] [role=alert]")).toContainText("Enter a price");
    await page.fill("#custom-price", "7.00");
    await page.fill("#custom-quantity", "0");
    await page.tap("dialog[open] button:has-text('Add to order')");
    await expect(page.locator("dialog[open] [role=alert]")).toContainText("quantity");
    await page.fill("#custom-quantity", "2");
    await page.tap("dialog[open] button:has-text('Add to order')");
    await expect(order(page)).toContainText("House tequila shot");
    await expect(order(page)).toContainText("Liquor subtotal$14.00", { useInnerText: false });
    await saveOrderButton(page).tap();
    await expect(page.getByText(/Order saved on ticket/)).toBeVisible();

    const number = await ticketNumberOnScreen(page);
    const batches = await batchesOf((await ticketByNumber(number)).id);
    expect(batches).toHaveLength(2);
    expect(batches[1]?.ticket_lines[0]).toMatchObject({
      item_name: "House tequila shot",
      unit_price_cents: 700,
      quantity: 2,
      tax_category_code: "cocktail",
      tax_group_code: "liquor",
      is_custom: true,
      menu_item_id: null,
    });
    await page.fill("#menu-search", "tequila shot");
    await expect(page.getByText("Nothing matches")).toBeVisible();
  });

  test("a saved quantity and a saved note can change; a tap shows at once", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${table}`);
    const number = await ticketNumberOnScreen(page);
    await page.tap("button[aria-label='One more saved Combo #5']");
    await expect(saved(page)).toContainText("3 × Combo #5", { timeout: 500 });
    await page.tap("button[aria-label='One more saved Combo #5']");
    await page.tap("button[aria-label='One fewer saved Combo #5']");
    await expect.poll(async () => (await batchesOf((await ticketByNumber(number)).id))[0]?.ticket_lines[0]?.quantity).toBe(3);

    await page.tap("button[aria-label='One fewer saved Combo #5']");
    await expect.poll(async () => (await batchesOf((await ticketByNumber(number)).id))[0]?.ticket_lines[0]?.quantity).toBe(2);

    await page.getByRole("button", { name: "Edit order note" }).first().tap();
    await page.fill("#edit-note", "Extra spicy");
    await page.tap("dialog[open] button:has-text('Save note')");
    await expect(page.getByText("Note: Extra spicy")).toBeVisible();
    await expect.poll(async () => (await batchesOf((await ticketByNumber(number)).id))[0]?.notes).toBe("Extra spicy");

    // An item's note can be changed after saving, leaving the other item's alone.
    await page.tap("button[aria-label='Edit the note on saved Domestic beer']");
    await expect(page.locator("dialog[open] h2")).toHaveText("Note for Domestic beer");
    await page.fill("#edit-note", "Cold glass");
    await page.tap("dialog[open] button:has-text('Save note')");
    await expect(saved(page).getByText("Note: Cold glass")).toBeVisible();
    await expect(saved(page).getByText("Note: Extra rice")).toBeVisible();
  });

  test("a change from an out-of-date screen is refused, never overwriting the other waiter", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${table}`);
    const number = await ticketNumberOnScreen(page);
    const before = await ticketByNumber(number);
    // Keep this screen from hearing about the other waiter's order, then change a saved line.
    await page.route("**/api/changes", (route) => route.abort());
    await saveOrder(table, kafi, [["Horchata", 1]]);
    await page.tap("button[aria-label='One more saved Combo #5']");
    await expect(page.locator("main [role=alert]")).toContainText("Someone else just changed this ticket");
    await page.unroute("**/api/changes");
    await expect(saved(page)).toContainText("2 × Combo #5");
    await expect(saved(page)).toContainText("Horchata");
    expect((await ticketByNumber(number)).version).toBe(before.version + 1);
  });

  test.describe("printing", () => {
    test("kitchen receipt: saves first, no prices, large and bold, only unsent orders; no duplicates", async ({ page }) => {
      // Saved but not sent to the kitchen: green, so the waiter knows it needs its kitchen receipt.
      const waiting = await tableInList(page, "X(1)", table);
      await expect(waiting).toContainText("Kitchen Receipt Saved");
      await expect(waiting).toHaveCSS("background-color", GREEN);
      await expect(await tableInList(page, "X(1)", "X8")).toHaveText("X8"); // a table with no order looks normal

      await stubPrinting(page);
      await page.goto(`/waiter/01/tables/${table}`);
      await expect(page.locator("main")).toContainText("Kitchen Receipt Saved");
      const number = await ticketNumberOnScreen(page);
      const ticket = await ticketByNumber(number);
      const before = (await batchesOf(ticket.id)).length;

      await item(page, "Lunch #3").tap();
      await page.fill("#order-notes", "No onions");
      // Press repeatedly: only one order may be saved and one receipt printed.
      await kitchenButton(page).tap();
      await kitchenButton(page).tap({ force: true }).catch(() => {});
      await kitchenButton(page).tap({ force: true }).catch(() => {});
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the kitchen receipt print?");
      expect(await prints(page)).toBe(1); // and a stray tap doesn't dismiss the question

      const batches = await batchesOf(ticket.id);
      expect(batches).toHaveLength(before + 1);
      const receipt = await lastReceipt(page);
      for (const part of ["EL LORITO — KITCHEN", `TICKET #${number}`, `TABLE: ${table}`, "WAITER: 01", "TIME: ", "1 × LUNCH #3", "NOTE: NO ONIONS"]) {
        expect(receipt).toContain(part);
      }
      expect(receipt).toContain("2 × COMBO #5> EXTRA RICE"); // each note under its own item
      expect(receipt).toContain("1 × DOMESTIC BEER> COLD GLASS");
      // All three unsent orders went together; nothing about money anywhere.
      expect(receipt).toContain("2 × COMBO #5");
      expect(receipt).not.toMatch(/\$|\d+\.\d\d|TAX|TOTAL|SUBTOTAL|PRICE/i);

      // In print mode: only the receipt shows, on the configured paper width, large and bold.
      await page.emulateMedia({ media: "print" });
      const style = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("[data-testid=kitchen-receipt]")!;
        const line = getComputedStyle(root.querySelector(".kitchen-item")!);
        return {
          display: getComputedStyle(root).display,
          width: root.style.width,
          fontSize: parseFloat(line.fontSize),
          fontWeight: Number(line.fontWeight),
          mainHidden: getComputedStyle(document.querySelector("main")!.parentElement!).display === "none",
          pageRule: root.querySelector("style")?.textContent ?? "",
        };
      });
      await page.emulateMedia({ media: "screen" });
      expect(style.display).toBe("block");
      expect(style.width).toBe("80mm");
      expect(style.fontSize).toBeGreaterThanOrEqual(20);
      expect(style.fontWeight).toBeGreaterThanOrEqual(700);
      expect(style.pageRule).toContain("size: 80mm auto");

      await answerNo(page);
      await expect(page.locator("dialog[open] h2")).toHaveText("The kitchen receipt didn't print");
      await page.click("dialog[open] button:has-text('Print again')");
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the kitchen receipt print?");
      expect(await prints(page)).toBe(2);
      await answerYes(page);
      await expect(page.getByText("Sent to the kitchen. The order stays on the ticket.")).toBeVisible();

      // Printing never locks the ticket or loses anything.
      expect((await ticketByNumber(number)).status).toBe("open");
      await expect(saved(page)).toContainText("Lunch #3");
      await expect(kitchenButton(page)).toBeDisabled(); // nothing left to send

      // The table says so, on its page and in blue on the waiter's list.
      await expect(page.locator("main")).toContainText("Kitchen Receipt Printed");
      await expect(page.locator("main")).not.toContainText("Kitchen Receipt Saved");
      const listed = await tableInList(page, "X(1)", table);
      await expect(listed).toContainText("Kitchen Receipt Printed");
      await expect(listed).toHaveCSS("background-color", BLUE);
      await expect(await tableInList(page, "X(1)", "X8")).not.toContainText("Kitchen Receipt Printed");
    });

    test("the next kitchen receipt shows only the new order, on the same ticket", async ({ page }) => {
      await stubPrinting(page);
      await page.goto(`/waiter/01/tables/${table}`);
      const number = await ticketNumberOnScreen(page);
      await item(page, "Lunch #1").tap();
      await saveOrderButton(page).tap();
      await expect(page.getByText(/Order saved on ticket/)).toBeVisible();

      // A new order needs its kitchen receipt, so the table goes back to green until that prints.
      const newOrder = await tableInList(page, "X(1)", table);
      await expect(newOrder).toContainText("Kitchen Receipt Saved");
      await expect(newOrder).toHaveCSS("background-color", GREEN);
      await page.goto(`/waiter/01/tables/${table}`);

      await kitchenButton(page).tap();
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the kitchen receipt print?");
      const receipt = await lastReceipt(page);
      expect(receipt).toContain("1 × LUNCH #1");
      expect(receipt).toContain(`TICKET #${number}`);
      expect(receipt).not.toContain("COMBO");
      expect(receipt).not.toContain("LUNCH #3");
      await answerYes(page);
      expect(await openTicketsAt(table)).toHaveLength(1);
      await expect(await tableInList(page, "X(1)", table)).toHaveCSS("background-color", BLUE);
    });

    test("an order can be reprinted, marked as a reprint", async ({ page }) => {
      await stubPrinting(page);
      await page.goto(`/waiter/01/tables/${table}`);
      await page.getByRole("button", { name: "Reprint order 1 for the kitchen" }).tap();
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the kitchen receipt print?");
      expect(await lastReceipt(page)).toContain("REPRINT");
      await answerYes(page);
    });

    test("customer receipt: everything saved, taxes, thermal width; a failed print doesn't finalize", async ({ page }) => {
      await stubPrinting(page);
      await page.goto(`/waiter/01/tables/${table}`);
      const number = await ticketNumberOnScreen(page);
      const ticket = await ticketByNumber(number);
      const totalBefore = await ticketTotal(number);

      await customerButton(page).tap();
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the customer receipt print?");
      await expect(page.locator("dialog[open]")).toContainText("Yes finalizes this ticket and resets the table");
      const receipt = await lastReceipt(page);
      for (const part of ["EL LORITO", `TICKET #${number}`, "WAITER: 01", `TABLE: ${table}`, "TIME: ", "2 × Combo #5", "$18.80", "@ 9.40 each", "2 × House tequila shot", "1 × Horchata", "Food Subtotal", "Liquor Subtotal", "Food Tax (8.5%)", "Liquor Tax (10.5%)", "TOTAL", "THANK YOU!"]) {
        expect(receipt).toContain(part);
      }
      expect(receipt).not.toContain("Kafi");
      expect(receipt).not.toMatch(/extra rice|cold glass/i); // item notes are for the kitchen

      await page.emulateMedia({ media: "print" });
      const width = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("[data-testid=receipt]")!;
        return { display: getComputedStyle(root).display, width: root.style.width };
      });
      await page.emulateMedia({ media: "screen" });
      expect(width).toEqual({ display: "block", width: "80mm" });

      // Opening the dialog changed nothing.
      expect((await ticketByNumber(number)).status).toBe("open");

      await answerNo(page);
      expect((await ticketByNumber(number)).status).toBe("open");
      await page.click("dialog[open] button:has-text('Back')");
      expect((await printAttempts(ticket.id)).at(-1)?.outcome).toBe("not_printed");

      // Leaving the question unanswered doesn't finalize either.
      await customerButton(page).tap();
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the customer receipt print?");
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      expect((await ticketByNumber(number)).status).toBe("open");
      expect((await printAttempts(ticket.id)).at(-1)?.outcome).toBe("unknown");
      expect(await ticketTotal(number)).toBe(totalBefore);
    });

    test("the bill can't be printed over an unsaved order", async ({ page }) => {
      await page.goto(`/waiter/01/tables/${table}`);
      await item(page, "Lunch #2").tap();
      await expect(customerButton(page)).toBeDisabled();
      await expect(page.getByText("Save the new order first")).toBeVisible();
      await page.tap("button[aria-label='Remove Lunch #2']");
      await expect(customerButton(page)).toBeEnabled();
    });

    test("Yes finalizes and resets the table: the receipt reprints exactly, and the next order is a new ticket", async ({ page }) => {
      await stubPrinting(page);
      await page.goto(`/waiter/01/tables/${table}`);
      const number = await ticketNumberOnScreen(page);
      const total = await ticketTotal(number);

      await customerButton(page).tap();
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the customer receipt print?");
      const printed = await lastReceipt(page);
      await answerYes(page);
      await expect(page.getByText(`Ticket #${number} is finalized. The table is ready for a new order.`)).toBeVisible();

      const final = await ticketByNumber(number);
      expect(final.status).toBe("finalized");
      expect(final.total_cents).toBe(total);
      expect(final.final_receipt).not.toBeNull();

      // The table is fresh: nothing of the old order, and the menu ready for the next one.
      await expect(page.locator("#saved-ticket-heading")).toHaveCount(0);
      await expect(page.locator("#menu-search")).toBeVisible();
      await expect(page.locator("button[aria-label^='One more saved']")).toHaveCount(0);
      expect(await openTicketsAt(table)).toHaveLength(0);

      // The table is normal again on the waiter's list.
      const listed = await tableInList(page, "X(1)", table);
      await expect(listed).toHaveText(table);
      await expect(listed).not.toHaveCSS("background-color", BLUE);
      await expect(listed).not.toHaveCSS("background-color", GREEN);
      await page.goto(`/waiter/01/tables/${table}`);
      await expect(page.locator("main")).not.toContainText("Kitchen Receipt Printed");

      // Tax and menu changes don't touch the copy.
      await setItem("Combo #5", 5000, true);
      await setTaxRate("food", 900);
      await page.reload();
      await page.locator(`a[aria-label^='Ticket ${number},']`).tap();
      await page.getByRole("button", { name: "Reprint Customer Receipt" }).tap();
      await expect(page.locator("dialog[open] h2")).toHaveText("Did the copy of the receipt print?");
      const copy = await lastReceipt(page);
      expect(copy.replace("COPY", "")).toBe(printed);
      await answerYes(page);
      await setItem("Combo #5", 940, true);
      await setTaxRate("food", 850);
      expect(await ticketTotal(number)).toBe(total);

      // The next order at this table is a new ticket; the finalized one stays as it was.
      await page.goto(`/waiter/01/tables/${table}`);
      await expect(page.locator("#saved-ticket-heading")).toHaveCount(0);
      await expect(page.locator("#menu-search")).toBeVisible();
      await item(page, "Lunch #2").tap();
      await saveOrderButton(page).tap();
      await expect(page.getByText(/Order saved on ticket/)).toBeVisible();
      const nextNumber = await ticketNumberOnScreen(page);
      expect(nextNumber).toBeGreaterThan(number);
      expect((await openTicketsAt(table))[0]?.ticket_number).toBe(nextNumber);
      expect((await ticketByNumber(number)).status).toBe("finalized");
    });
  });
});
