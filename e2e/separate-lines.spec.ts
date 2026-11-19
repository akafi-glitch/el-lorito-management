import { expect, test, type Page } from "@playwright/test";

import { batchesOf, cancelOpenOrders, employee, openTicketsAt, startShift } from "./support/db";
import { lastReceipt, stubPrinting, waitForPrint } from "./support/print";

// Owner decisions, Nov 18, 2026: every tap adds a line of its own, so the same item can carry different notes;
// + raises one line. And the Misc page from the owner's price list.
const TABLE = "B2";
const order = (page: Page) => page.locator("#current-order");
const add = (page: Page, name: string) => page.locator(`button[aria-label^='Add ${name},']`).first();

test.describe.serial("the same item on separate lines", () => {
  test.beforeAll(async () => {
    await startShift();
    await employee("01", "Kafi", "waiter");
    await cancelOpenOrders([TABLE]);
  });

  test.afterAll(async () => {
    await cancelOpenOrders([TABLE]);
  });

  test("tapping an item twice makes two lines, each with its own note; + raises one line", async ({ page }) => {
    await stubPrinting(page);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await page.fill("#menu-search", "combo 5");
    await add(page, "Combo #5").click();
    await add(page, "Combo #5").click();
    await expect(add(page, "Combo #5")).toHaveAttribute("aria-label", /2 in order/);

    const notes = order(page).getByLabel("Note for Combo #5");
    await expect(notes).toHaveCount(2);
    await notes.nth(0).fill("No tomato");
    await notes.nth(1).fill("No avocado");
    await order(page).getByRole("button", { name: "One more Combo #5" }).nth(1).click();
    await expect(order(page).getByRole("group", { name: "Quantity of Combo #5" }).nth(0)).toContainText("1");
    await expect(order(page).getByRole("group", { name: "Quantity of Combo #5" }).nth(1)).toContainText("2");
    await expect(order(page)).toContainText("Food subtotal$28.20", { useInnerText: false }); // 3 × $9.40

    await page.getByRole("button", { name: "Print Kitchen Receipt", exact: true }).click();
    await waitForPrint(page, 1);
    const receipt = await lastReceipt(page);
    expect(receipt).toContain("•1 × COMBO #5> NO TOMATO");
    expect(receipt).toContain("•2 × COMBO #5> NO AVOCADO");

    const [ticket] = await openTicketsAt(TABLE);
    const [batch] = await batchesOf(ticket!.id);
    expect(batch?.ticket_lines.map((line) => [line.item_name, line.quantity, line.notes])).toEqual([
      ["Combo #5", 1, "No tomato"],
      ["Combo #5", 2, "No avocado"],
    ]);
  });

  test("the Misc page lists the owner's price list", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await page.click("nav[aria-label='Menu categories'] button:text-is('Misc')");
    await expect(page.getByRole("heading", { name: "Misc", exact: true })).toBeVisible();
    await expect(add(page, "Quesa Camaron Carta")).toHaveAttribute("aria-label", /\$6\.99/);
    await expect(add(page, "Camaron Solo")).toHaveAttribute("aria-label", /\$0\.95/);
    await expect(add(page, "Chile Colorado con Cheese Dip")).toHaveAttribute("aria-label", /\$3\.50/);
    await page.fill("#menu-search", "cebolla taco");
    await expect(add(page, "Cebolla en Taco")).toHaveAttribute("aria-label", /\$0\.25/);
  });
});
