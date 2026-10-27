import { describe, expect, it } from "vitest";
import { z } from "zod";

import fixture from "../../../tests/fixtures/menu-rows.json";

import { buildMenu } from "./build";
import { menuErrorMessage } from "./errors";
import { formatCents, lineTotalCents, parseDollars } from "./money";
import { addItem, priceDraft, quantityOf, removeItem, setQuantity, type Draft } from "./order-draft";
import { currentPriceCents, formatTimeOfDay, isLate, parseTimeOfDay, restaurantMinutes } from "./pricing";
import { menuCategoryRowSchema, menuItemRowSchema, updateMenuItemSchema } from "./schema";
import { normalizeText, searchMenu } from "./search";
import type { Menu } from "./types";

/** The real menu rows, exported from a database after running the migrations. */
function realMenu(): Menu {
  return buildMenu(z.array(menuCategoryRowSchema).parse(fixture.categories), z.array(menuItemRowSchema).parse(fixture.items));
}

const menu = realMenu();
const allItems = menu.categories.flatMap((c) => c.items);
const item = (name: string) => {
  const found = allItems.find((i) => i.name === name);
  if (!found) throw new Error(`no item ${name}`);
  return found;
};
const categoryOf = (name: string) => menu.categories.find((c) => c.items.some((i) => i.name === name))!;
const CHICAGO = "America/Chicago";
/** 2026-10-27 at the given Chicago wall time (CDT, UTC-5). */
const chicago = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00-05:00`);

describe("menu from the database", () => {
  it("has 26 categories in menu order, starting with Lunch", () => {
    expect(menu.categories).toHaveLength(26);
    expect(menu.categories.slice(0, 3).map((c) => c.name)).toEqual(["Lunch", "Appetizers", "Nachos"]);
    expect(menu.categories.at(-1)?.name).toBe("Cocktails");
  });

  it("has the 206 items of the menu file plus 4 cheese-dip add-ons", () => {
    expect(allItems).toHaveLength(210);
    expect(menu.categories.find((c) => c.code === "cheese-dip-add-ons")?.items.map((i) => [i.name, i.priceCents])).toEqual([
      ["Cheese dip on lunch enchilada", 125],
      ["Cheese dip on lunch burrito", 150],
      ["Cheese dip on combo enchilada", 100],
      ["Cheese dip on combo burrito", 125],
    ]);
  });

  it("keeps the menu's order inside a category", () => {
    const lunch = menu.categories[0]!;
    expect(lunch.items.slice(0, 3).map((i) => i.name)).toEqual(["Lunch #1", "Lunch #2", "Lunch #3"]);
  });

  it("chile con queso is $5.19", () => {
    expect(item("Chile con queso").priceCents).toBe(519);
  });

  it("gives every item a tax category: beer and cocktails are liquor, soft drinks are not", () => {
    expect(item("Domestic beer").taxCategory).toBe("beer");
    expect(item("Paloma").taxCategory).toBe("cocktail");
    expect(item("Horchata").taxCategory).toBe("nonalcoholic");
    expect(item("Molcajete").taxCategory).toBe("food");
  });

  it("only Lunch has late pricing: from 3:00 PM, $1.00 more", () => {
    expect(menu.categories.filter((c) => c.late).map((c) => [c.name, c.late])).toEqual([
      ["Lunch", { fromMinutes: 900, surchargeCents: 100 }],
    ]);
  });

  it("leaves out a turned-off category", () => {
    const rows = z.array(menuCategoryRowSchema).parse(fixture.categories).map((row) => (row.code === "beer" ? { ...row, is_active: false } : row));
    expect(buildMenu(rows, z.array(menuItemRowSchema).parse(fixture.items)).categories).toHaveLength(25);
  });
});

describe("money in whole cents", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(825)).toBe("$8.25");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("reads typed prices without rounding guesses", () => {
    expect(parseDollars("8.25")).toBe(825);
    expect(parseDollars("$8.2")).toBe(820);
    expect(parseDollars(" 8 ")).toBe(800);
    expect(parseDollars("0.10")).toBe(10);
    expect(parseDollars("8.255")).toBeNull();
    expect(parseDollars("-1")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("10000.01")).toBeNull();
  });

  it("adds prices exactly where floating point would not (0.10 + 0.20)", () => {
    const { subtotalCents } = priceDraft(
      [
        { itemId: 1, quantity: 1 },
        { itemId: 2, quantity: 1 },
      ],
      (id) => ({ name: String(id), unitCents: id === 1 ? 10 : 20 }),
    );
    expect(subtotalCents).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("multiplies a line safely", () => {
    expect(lineTotalCents(799, 3)).toBe(2397);
  });

  it("validates the management price input", () => {
    expect(updateMenuItemSchema.safeParse({ id: 1, price: "9.40", isAvailable: true }).data).toEqual({ id: 1, price: 940, isAvailable: true });
    expect(updateMenuItemSchema.safeParse({ id: 1, price: "9.405", isAvailable: true }).success).toBe(false);
  });
});

describe("lunch price after 3 PM", () => {
  const lunch = categoryOf("Lunch #2").late;

  it("reads database times", () => {
    expect(parseTimeOfDay("15:00:00")).toBe(900);
    expect(parseTimeOfDay("15:00")).toBe(900);
    expect(() => parseTimeOfDay("25:00")).toThrow();
    expect(formatTimeOfDay(900)).toBe("3:00 PM");
    expect(formatTimeOfDay(0)).toBe("12:00 AM");
  });

  it("uses the restaurant's clock, not the device's", () => {
    expect(restaurantMinutes(new Date("2026-10-27T20:00:00Z"), CHICAGO)).toBe(15 * 60);
    expect(restaurantMinutes(new Date("2026-10-27T20:00:00Z"), "UTC")).toBe(20 * 60);
  });

  it("charges the menu price until 2:59 PM", () => {
    expect(isLate(lunch, chicago("14:59"), CHICAGO)).toBe(false);
    expect(currentPriceCents(799, lunch, chicago("11:00"), CHICAGO)).toBe(799);
  });

  it("adds $1.00 from 3:00 PM", () => {
    expect(currentPriceCents(799, lunch, chicago("15:00"), CHICAGO)).toBe(899);
    expect(currentPriceCents(799, lunch, chicago("21:30"), CHICAGO)).toBe(899);
  });

  it("never changes items without late pricing", () => {
    expect(currentPriceCents(940, categoryOf("Combo #1").late, chicago("20:00"), CHICAGO)).toBe(940);
    expect(currentPriceCents(125, categoryOf("Cheese dip on lunch enchilada").late, chicago("20:00"), CHICAGO)).toBe(125);
  });
});

describe("menu search", () => {
  const names = (query: string) => searchMenu(menu.categories, query).map((hit) => hit.item.name);

  it("ignores case, accents and punctuation", () => {
    expect(normalizeText("Jalapeños, #5!")).toBe("jalapenos 5");
  });

  it("finds Combo #5 and not Combo #15", () => {
    expect(names("combo 5")).toEqual(["Combo #5"]);
  });

  it("matches the start of words in name, description, or category", () => {
    expect(names("margarita")).toContain("Lime margarita (large)");
    expect(names("chile con queso")).toContain("Chile con queso");
    expect(names("dessert")).toEqual(["Fried ice cream", "Sopapilla (4)", "Flan (Mexican custard) (1)"]);
  });

  it("lists name matches before description matches", () => {
    const hits = names("fajitas");
    expect(hits.length).toBeGreaterThan(5);
    const firstDescriptionOnly = hits.findIndex((name) => !normalizeText(name).split(" ").some((w) => w.startsWith("fajitas")));
    const lastNameMatch = hits.map((name) => normalizeText(name).split(" ").some((w) => w.startsWith("fajitas"))).lastIndexOf(true);
    expect(firstDescriptionOnly === -1 || lastNameMatch < firstDescriptionOnly).toBe(true);
  });

  it("returns nothing for an empty search or no match", () => {
    expect(names("  ")).toEqual([]);
    expect(names("pizza burger sushi")).toEqual([]);
  });
});

describe("the order on screen", () => {
  const taco = item("Taco").id;
  const combo = item("Combo #5").id;

  it("adds, counts up, and keeps the order items were added in", () => {
    let draft: Draft = [];
    draft = addItem(draft, taco);
    draft = addItem(draft, combo);
    draft = addItem(draft, taco);
    expect(draft).toEqual([
      { itemId: taco, quantity: 2 },
      { itemId: combo, quantity: 1 },
    ]);
    expect(quantityOf(draft, taco)).toBe(2);
  });

  it("keeps quantities between 1 and 99", () => {
    const draft: Draft = [{ itemId: taco, quantity: 1 }];
    expect(setQuantity(draft, taco, 0)).toEqual([{ itemId: taco, quantity: 1 }]);
    expect(setQuantity(draft, taco, 250)).toEqual([{ itemId: taco, quantity: 99 }]);
  });

  it("removes a line", () => {
    expect(removeItem([{ itemId: taco, quantity: 3 }], taco)).toEqual([]);
  });

  it("totals the lines: 2 tacos + 1 Combo #5 = $14.10", () => {
    const priced = priceDraft(
      [
        { itemId: taco, quantity: 2 },
        { itemId: combo, quantity: 1 },
      ],
      (id) => {
        const found = allItems.find((i) => i.id === id);
        return found ? { name: found.name, unitCents: found.priceCents } : undefined;
      },
    );
    expect(priced.lines.map((l) => l.totalCents)).toEqual([470, 940]);
    expect(priced.itemCount).toBe(3);
    expect(priced.subtotalCents).toBe(1410);
  });

  it("drops a line whose item disappeared", () => {
    expect(priceDraft([{ itemId: 999999, quantity: 1 }], () => undefined).lines).toEqual([]);
  });
});

describe("messages", () => {
  it("explains database refusals in plain words", () => {
    expect(menuErrorMessage({ message: "menu_item_not_found" })).toContain("no longer exists");
    expect(menuErrorMessage({ code: "23514", message: "x" })).toContain("isn't allowed");
    expect(menuErrorMessage({ message: "boom" })).toContain("couldn't be saved");
  });
});
