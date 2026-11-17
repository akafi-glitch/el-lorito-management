import { expect, test, type Page } from "@playwright/test";

import { batchesOf, cancelOpenOrders, employee, openTicketsAt, setItem, startShift } from "./support/db";
import { answerYes, lastReceipt, stubPrinting, waitForPrint } from "./support/print";

// The Nov 16, 2026 menu: beef or chicken, the drink and extras lists, Kids Plates, and English for the kitchen.
const TABLE = "B5";
const order = (page: Page) => page.locator("#current-order");
const search = async (page: Page, text: string) => page.fill("#menu-search", text);
const menuButton = (page: Page, name: string) => page.locator(`button[aria-label^='Add ${name},']`).first();
const question = (page: Page) => page.locator("dialog[open]");

test.describe.serial("menu choices", () => {
  test.beforeAll(async () => {
    await startShift();
    await employee("01", "Kafi", "waiter");
    await setItem("Monterrey", 1099, true);
    await cancelOpenOrders([TABLE]);
  });

  test.afterAll(async () => {
    await cancelOpenOrders([TABLE]);
  });

  test("an item that comes with beef or chicken asks which, and says it on the order", async ({ page }) => {
    await stubPrinting(page);
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await search(page, "monterrey");
    await expect(menuButton(page, "Monterrey (Beef)")).toHaveCount(0); // the choices aren't on the menu by themselves
    await menuButton(page, "Monterrey").click();
    await expect(question(page).locator("h2")).toHaveText("Monterrey");
    await expect(question(page).getByRole("button")).toHaveText(["1. Beef$10.99", "2. Chicken$10.99", "Cancel"]);
    await question(page).getByRole("button", { name: /Beef/ }).click();
    await expect(question(page)).toHaveCount(0);
    await expect(order(page)).toContainText("Monterrey (Beef)");

    // Cancel adds nothing; the other choice is its own line.
    await menuButton(page, "Monterrey").click();
    await question(page).getByRole("button", { name: "Cancel" }).click();
    await expect(order(page)).not.toContainText("Monterrey (Chicken)");
    await menuButton(page, "Monterrey").click();
    await question(page).getByRole("button", { name: /Chicken/ }).click();
    await expect(order(page)).toContainText("Monterrey (Chicken)");
    await expect(menuButton(page, "Monterrey")).toHaveAttribute("aria-label", /2 in order/);

    // The side-order chimichanga is named apart from the main course, and asks too.
    await search(page, "chimichanga side");
    await menuButton(page, "Chimichanga (Side order)").click();
    await question(page).getByRole("button", { name: /Beef/ }).click();
    await expect(order(page)).toContainText("Chimichanga (Side order) (Beef)");

    // Lists: a soft drink, an extra, the new agua fresca, a kids plate.
    for (const [text, name] of [["coke zero", "Coke Zero"], ["sour cream", "Sour cream"], ["mango", "Mango (No Refills)"], ["kids plate 3", "Kids Plate #3"]] as const) {
      await search(page, text);
      await menuButton(page, name).click();
      await expect(question(page)).toHaveCount(0); // no question for these
    }
    await expect(order(page)).toContainText("Coke Zero");
    await expect(order(page)).toContainText("$2.99");
    await expect(order(page)).toContainText("Sour cream");
    await expect(order(page)).toContainText("$1.50");
    await expect(order(page)).toContainText("Mango (No Refills)");
    await expect(order(page)).toContainText("Kids Plate #3");

    await page.getByRole("button", { name: "Print Kitchen Receipt", exact: true }).click();
    await waitForPrint(page, 1);
    const receipt = await lastReceipt(page);
    for (const part of ["1 × MONTERREY (BEEF)", "1 × MONTERREY (CHICKEN)", "1 × CHIMICHANGA (SIDE ORDER) (BEEF)", "1 × KIDS PLATE #3", "DRINKS", "1 × COKE ZERO", "1 × MANGO (NO REFILLS)", "1 × SOUR CREAM"]) {
      expect(receipt).toContain(part);
    }
    expect(receipt).not.toMatch(/RES\)|POLLO|PLATO INFANTIL/); // English for the kitchen
    await answerYes(page);

    const [ticket] = await openTicketsAt(TABLE);
    const names = (await batchesOf(ticket!.id)).flatMap((batch) => batch.ticket_lines.map((line) => [line.item_name, line.unit_price_cents]));
    expect(names).toEqual(
      expect.arrayContaining([
        ["Monterrey (Beef)", 1099],
        ["Monterrey (Chicken)", 1099],
        ["Chimichanga (Side order) (Beef)", 625],
        ["Coke Zero", 299],
        ["Sour cream", 150],
        ["Mango (No Refills)", 325],
        ["Kids Plate #3", 699],
      ]),
    );
  });

  test("the old single soft drink and extras items are gone from the menu", async ({ page }) => {
    await page.goto(`/waiter/01/tables/${TABLE}`);
    await search(page, "soft drink");
    await expect(menuButton(page, "Soft drink")).toHaveCount(0);
    await search(page, "extras each");
    await expect(menuButton(page, "Extras (each)")).toHaveCount(0);
  });
});
