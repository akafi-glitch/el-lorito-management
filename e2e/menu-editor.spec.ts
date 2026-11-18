import { expect, test, type Page } from "@playwright/test";

import { cancelOpenOrders, employee, removeMenuItemsNamed, startShift } from "./support/db";

// The manager edits the menu (Nov 17, 2026): add an item, give it options, change it, take it off.
const ITEM = "E2E Torta";
const TABLE = "B6";
const row = (page: Page, name: string) => page.getByRole("list", { name: "Menu items" }).getByRole("listitem").filter({ hasText: name }).first();
const notice = (page: Page) => page.locator("div[aria-live=polite] > p[role=status]"); // the action notice, not the live-connection line
const waiterSees = async (page: Page, search: string) => {
  await page.goto(`/waiter/01/tables/${TABLE}`);
  await page.fill("#menu-search", search);
};

test.describe.serial("the manager's menu", () => {
  test.beforeAll(async () => {
    await startShift();
    await employee("01", "Kafi", "waiter");
    await removeMenuItemsNamed(ITEM);
    await cancelOpenOrders([TABLE]);
  });

  test.afterAll(async () => {
    await removeMenuItemsNamed(ITEM);
    await cancelOpenOrders([TABLE]);
  });

  test("a manager adds an item with options, and waiters choose from them at once", async ({ page }) => {
    await page.goto("/manage/menu");
    const favorites = await page.locator("#menu-category option", { hasText: /^Favorites/ }).getAttribute("value");
    await page.selectOption("#menu-category", favorites!);

    await page.getByRole("button", { name: "Add an item to Favorites" }).click();
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.locator("main [role=alert]")).toHaveText("Enter the item's name."); // checked before anything is saved
    await page.fill("#new-item-name", ITEM);
    await page.fill("#new-item-description", "Pressed sandwich");
    await page.fill("#new-item-price", "9.75");
    await page.selectOption("#new-item-tax", "food");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(notice(page)).toHaveText(`${ITEM} added at $9.75.`);
    await expect(row(page, ITEM)).toContainText("$9.75");

    await row(page, ITEM).getByRole("button", { name: `Edit ${ITEM}` }).click();
    for (const option of ["Beef", "Chicken"]) {
      await row(page, ITEM).getByLabel("New option").fill(option);
      await row(page, ITEM).getByRole("button", { name: "Add option" }).click();
      await expect(notice(page)).toContainText(`Option ${option} added`);
    }
    await expect(row(page, ITEM)).toContainText("Options: Beef · Chicken");
    await expect(row(page, ITEM).getByLabel("New option")).toBeVisible(); // the editor stays open for the next one

    // An option that costs extra (Nov 18, 2026): the extra goes on top of the item's price.
    await row(page, ITEM).getByLabel("New option").fill("Shrimp");
    await row(page, ITEM).getByLabel("Yes, extra charge").check();
    await row(page, ITEM).getByLabel("Extra price in dollars").fill("3");
    await expect(row(page, ITEM)).toContainText("Added to $9.75: the option costs $12.75.");
    await row(page, ITEM).getByRole("button", { name: "Add option" }).click();
    await expect(notice(page)).toContainText("Option Shrimp added at $3.00 extra.");
    await expect(row(page, ITEM)).toContainText("Options: Beef · Chicken · Shrimp (+$3.00)");
    await expect(row(page, ITEM).getByLabel("No extra charge")).toBeChecked(); // ready for the next option

    await waiterSees(page, "e2e torta");
    await page.locator(`button[aria-label^='Add ${ITEM},']`).click();
    await expect(page.locator("dialog[open] h2")).toHaveText(ITEM);
    await expect(page.locator("dialog[open]").getByRole("button")).toHaveText(["1. Beef$9.75", "2. Chicken$9.75", "3. Shrimp (+$3.00)$12.75", "Cancel"]);
    await page.locator("dialog[open]").getByRole("button", { name: /Chicken/ }).click();
    await expect(page.locator("#current-order")).toContainText(`${ITEM} (Chicken)`);
    await page.locator(`button[aria-label^='Add ${ITEM},']`).click();
    await page.locator("dialog[open]").getByRole("button", { name: /Shrimp/ }).click();
    const shrimp = page.locator("#current-order li").filter({ hasText: `${ITEM} (Shrimp)` });
    await expect(shrimp).toContainText("$12.75");
    await expect(page.locator("#current-order")).toContainText("$22.50"); // $9.75 + $12.75 before tax
  });

  test("a change reaches the item and its options; an option or the item comes off", async ({ page }) => {
    await page.goto("/manage/menu");
    await page.fill("#menu-manage-search", "e2e torta");
    await row(page, ITEM).getByRole("button", { name: `Edit ${ITEM}` }).click();
    await row(page, ITEM).getByLabel("Price in dollars").fill("10.25");
    await row(page, ITEM).getByRole("button", { name: "Save changes" }).click();
    await expect(notice(page)).toHaveText(`${ITEM} saved: $10.25, available.`);

    await waiterSees(page, "e2e torta");
    await page.locator(`button[aria-label^='Add ${ITEM},']`).click();
    await expect(page.locator("dialog[open]").getByRole("button", { name: /Beef/ })).toHaveText("1. Beef$10.25");
    await expect(page.locator("dialog[open]").getByRole("button", { name: /Shrimp/ })).toHaveText("3. Shrimp (+$3.00)$13.25"); // the extra stays on top

    // The extra charge can change.
    await page.goto("/manage/menu");
    await page.fill("#menu-manage-search", "e2e torta");
    await row(page, ITEM).getByRole("button", { name: `Edit ${ITEM}` }).click();
    await row(page, ITEM).getByRole("button", { name: "Extra charge for Shrimp" }).click();
    await row(page, ITEM).getByLabel("Extra price for Shrimp").fill("4.50");
    await row(page, ITEM).getByRole("button", { name: "Save extra charge" }).click();
    await expect(notice(page)).toHaveText(`${ITEM} (Shrimp): $4.50 extra.`);
    await expect(row(page, ITEM)).toContainText("Shrimp (+$4.50)");
    await waiterSees(page, "e2e torta");
    await page.locator(`button[aria-label^='Add ${ITEM},']`).click();
    await expect(page.locator("dialog[open]").getByRole("button", { name: /Shrimp/ })).toHaveText("3. Shrimp (+$4.50)$14.75");

    await page.goto("/manage/menu");
    await page.fill("#menu-manage-search", "e2e torta");
    await row(page, ITEM).getByRole("button", { name: `Edit ${ITEM}` }).click();
    await row(page, ITEM).getByRole("button", { name: "Remove option Chicken" }).click();
    await expect(row(page, ITEM).getByRole("alertdialog")).toContainText("Remove the option Chicken from the menu?");
    await row(page, ITEM).getByRole("button", { name: "Yes, remove" }).click();
    await expect(row(page, ITEM)).toContainText("Options: Beef");
    await expect(row(page, ITEM)).not.toContainText("Chicken");

    await row(page, ITEM).getByRole("button", { name: `Remove ${ITEM} from the menu` }).click();
    await row(page, ITEM).getByRole("button", { name: "Yes, remove" }).click();
    await expect(notice(page)).toHaveText(`${ITEM} is off the menu. Saved tickets keep it.`);
    await expect(page.getByRole("list", { name: "Menu items" })).not.toContainText(ITEM);

    await waiterSees(page, "e2e torta");
    await expect(page.getByText("Nothing matches")).toBeVisible();
  });

  test("beer: each bottle has its price, and a draft asks which beer", async ({ page }) => {
    await waiterSees(page, "corona");
    await expect(page.locator("button[aria-label^='Add Corona,']")).toHaveAttribute("aria-label", /\$5\.25/);
    await page.fill("#menu-search", "bud light");
    await expect(page.locator("button[aria-label^='Add Bud Light,']")).toHaveAttribute("aria-label", /\$4\.99/);
    await page.fill("#menu-search", "draft beer 12");
    await page.locator("button[aria-label^='Add Draft beer - 12 oz,']").click();
    await expect(page.locator("dialog[open]").getByRole("button")).toHaveText([
      "1. Bud Light$3.25", "2. Budweiser$3.25", "3. Michelob Ultra$3.25", "4. Coors Light$3.25", "5. Miller Light$3.25", "Cancel",
    ]);
    await page.locator("dialog[open]").getByRole("button", { name: /Coors Light/ }).click();
    await expect(page.locator("#current-order")).toContainText("Draft beer - 12 oz (Coors Light)");
  });
});
