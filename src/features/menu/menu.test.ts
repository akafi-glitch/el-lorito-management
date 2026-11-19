import { describe, expect, it } from "vitest";
import { z } from "zod";

import fixture from "../../../tests/fixtures/menu-rows.json";

import { buildMenu } from "./build";
import { menuErrorMessage } from "./errors";
import { formatCents, lineTotalCents, parseDollars } from "./money";
import { parseCustomItem } from "./custom-item";
import { addCustomItem, addItem, priceDraft, quantityOf, removeLine, setItemNote, setQuantity, type Draft } from "./order-draft";
import { currentPriceCents, formatTimeOfDay, isLate, parseTimeOfDay, restaurantMinutes } from "./pricing";
import { addMenuItemSchema, addMenuOptionSchema, editMenuItemSchema, extraCents, menuCategoryRowSchema, menuItemRowSchema, setMenuOptionExtraSchema, updateMenuItemSchema } from "./schema";
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
  it("has 27 categories in menu order, starting with Lunch and ending with Misc (Nov 18, 2026)", () => {
    expect(menu.categories).toHaveLength(27);
    expect(menu.categories.slice(0, 3).map((c) => c.name)).toEqual(["Lunch", "Appetizers", "Nachos"]);
    expect(menu.categories.at(-2)?.name).toBe("Cocktails");
    expect(menu.categories.at(-1)?.name).toBe("Misc");
  });

  it("has the menu file's items, the 4 cheese-dip add-ons, and the Nov 16 and 17, 2026 lists", () => {
    // 206 + 4, minus "Soft drink", "Extras (each)", "Domestic beer", and "Import beer" (retired),
    // plus 10 soft drinks, 6 extras, Mango, 15 bottled beers, and the 33 Misc items.
    expect(allItems).toHaveLength(271);
    expect(menu.categories.find((c) => c.code === "cheese-dip-add-ons")?.items.map((i) => [i.name, i.priceCents])).toEqual([
      ["Cheese dip on lunch enchilada", 125],
      ["Cheese dip on lunch burrito", 150],
      ["Cheese dip on combo enchilada", 100],
      ["Cheese dip on combo burrito", 125],
    ]);
  });

  it("names the kids' plates Kids Plate #1 to #10, with the plate as the description", () => {
    const kids = menu.categories.find((c) => c.code === "childs-plates")!.items;
    expect(kids.map((i) => i.name)).toEqual(Array.from({ length: 10 }, (_, n) => `Kids Plate #${n + 1}`));
    expect(item("Kids Plate #1").description).toBe("Enchilada, rice and beans");
    expect(searchMenu(menu.categories, "kids plate").length).toBe(10);
  });

  it("lists every soft drink at $2.99 and every extra at $1.50, each searchable", () => {
    const drinks = menu.categories.find((c) => c.code === "soft-drinks")!.items;
    expect(drinks.map((i) => i.name)).toEqual([
      "Coke", "Coke Zero", "Diet Coke", "Pibb", "Fanta (Orange)", "Sprite", "Root Beer", "Cream Soda", "Minute Maid Lemonade", "Raspberry Tea",
    ]);
    expect(new Set(drinks.map((i) => [i.priceCents, i.taxCategory].join()))).toEqual(new Set(["299,nonalcoholic"]));
    const extras = menu.categories.find((c) => c.code === "extras")!.items;
    expect(extras.map((i) => i.name)).toEqual(["Sour cream", "Grated cheese", "Tortillas", "Jalapeños", "Pico de gallo", "Hot sauce"]);
    expect(new Set(extras.map((i) => i.priceCents))).toEqual(new Set([150]));
    expect(searchMenu(menu.categories, "coke zero")[0]?.item.name).toBe("Coke Zero");
    expect(searchMenu(menu.categories, "sour cream")[0]?.item.name).toBe("Sour cream");
    expect(allItems.some((i) => i.name === "Soft drink" || i.name === "Extras (each)")).toBe(false); // retired
  });

  it("lists every bottled beer with its price, and each draft asks which beer (Nov 17, 2026)", () => {
    const beer = menu.categories.find((c) => c.code === "beer")!.items;
    expect(beer.slice(0, 15).map((i) => [i.name, i.priceCents])).toEqual([
      ["Bud Light", 499], ["Budweiser", 499], ["Miller Light", 499], ["Coors Light", 499], ["Michelob Ultra", 499],
      ["Blue Moon", 525], ["Corona", 525], ["Modelo Especial", 525], ["Negra Modelo", 525], ["Sol", 525],
      ["Pacifico", 525], ["XX Lager", 525], ["Tecate", 525], ["XX Amber", 525], ["Carta Blanca", 525],
    ]);
    expect(new Set(beer.map((i) => i.taxCategory))).toEqual(new Set(["beer"]));
    expect(item("Draft beer - 12 oz").choices.map((c) => c.choiceLabel)).toEqual(["Bud Light", "Budweiser", "Michelob Ultra", "Coors Light", "Miller Light"]);
    expect(item("Import draft beer - 32 oz").choices.map((c) => [c.name, c.priceCents])[0]).toEqual(["Import draft beer - 32 oz (XX Amber)", 799]);
    expect(searchMenu(menu.categories, "corona")[0]?.item.name).toBe("Corona");
    expect(allItems.some((i) => i.name === "Domestic beer" || i.name === "Import beer")).toBe(false); // retired
  });

  it("has the owner's Misc price list: 33 items, each at its price, searchable (Nov 18, 2026)", () => {
    const misc = menu.categories.find((c) => c.code === "misc")!.items;
    expect(misc).toHaveLength(33);
    expect(misc.slice(0, 3).map((i) => [i.name, i.priceCents])).toEqual([
      ["Quesa Camaron Carta", 699], ["Pieza de CHT Tender", 235], ["CHT Tender Dinner 4 Piezas", 899],
    ]);
    expect(item("Camaron Solo").priceCents).toBe(95);
    expect(item("Cebolla en Taco").priceCents).toBe(25);
    expect(item("Chile Colorado con Cheese Dip").priceCents).toBe(350);
    expect(item("Michelada de Agua Mineral").taxCategory).toBe("nonalcoholic");
    expect(misc.filter((i) => i.taxCategory !== "food").map((i) => i.name)).toEqual(["Michelada de Agua Mineral"]);
    expect(searchMenu(menu.categories, "camaron solo")[0]?.item.name).toBe("Camaron Solo");
  });

  it("adds Mango (No Refills) to the aguas frescas at $3.25", () => {
    expect(item("Mango (No Refills)")).toMatchObject({ priceCents: 325, taxCategory: "nonalcoholic" });
  });

  it("puts Beef and Chicken under the items that come with either, not on the menu by themselves", () => {
    const withChoices = allItems.filter((i) => i.choices.length > 0).map((i) => i.name);
    expect(withChoices.sort()).toEqual([
      "Beef or chicken fajitas", "Chimichanga", "Chimichanga (Side order)", "Draft beer - 12 oz", "Draft beer - 32 oz",
      "Import draft beer - 12 oz", "Import draft beer - 32 oz", "Monterrey", "Quesadilla Grande",
      "Steak quesadilla (chicken or beef)", "Taco salad (chicken or beef)", "Taco salad fajita (beef or chicken)", "Taquitos Mexicanos",
    ]);
    expect(item("Taco salad fajita (beef or chicken)").choices.map((c) => [c.name, c.choiceLabel])).toEqual([
      ["Taco salad fajita (Beef)", "Beef"],
      ["Taco salad fajita (Chicken)", "Chicken"],
    ]);
    expect(item("Monterrey").choices.map((c) => [c.name, c.choiceLabel, c.priceCents])).toEqual([
      ["Monterrey (Beef)", "Beef", 1099],
      ["Monterrey (Chicken)", "Chicken", 1099],
    ]);
    expect(item("Beef or chicken fajitas").choices.map((c) => c.name)).toEqual(["Beef or chicken fajitas (Beef)", "Beef or chicken fajitas (Chicken)"]);
    expect(item("Chimichanga (Side order)").choices.map((c) => c.name)).toEqual(["Chimichanga (Side order) (Beef)", "Chimichanga (Side order) (Chicken)"]);
    expect(allItems.some((i) => i.name === "Monterrey (Beef)")).toBe(false);
    expect(categoryOf("Chimichanga (Side order)").code).toBe("side-orders");
  });

  it("keeps the menu's order inside a category", () => {
    const lunch = menu.categories[0]!;
    expect(lunch.items.slice(0, 3).map((i) => i.name)).toEqual(["Lunch #1", "Lunch #2", "Lunch #3"]);
  });

  it("chile con queso is $5.19", () => {
    expect(item("Chile con queso").priceCents).toBe(519);
  });

  it("gives every item a tax category: beer and cocktails are liquor, soft drinks are not", () => {
    expect(item("Bud Light").taxCategory).toBe("beer");
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
    expect(buildMenu(rows, z.array(menuItemRowSchema).parse(fixture.items)).categories).toHaveLength(26);
  });
});

describe("a note on one line of the order", () => {
  const draft: Draft = [
    { key: 1, itemId: 1, quantity: 1 },
    { key: 2, itemId: 2, quantity: 2 },
  ];

  it("stays on that line only", () => {
    const noted = setItemNote(setItemNote(draft, 1, "No onions"), 2, "Extra rice");
    expect(noted.map((line) => line.note)).toEqual(["No onions", "Extra rice"]);
    expect(setItemNote(draft, 1, "No onions")[1]?.note).toBeUndefined();
  });

  it("survives changing the quantity; tapping the item again adds a new line with no note", () => {
    const noted = setItemNote(draft, 1, "No onions");
    expect(setQuantity(noted, 1, 5)[0]).toEqual({ key: 1, itemId: 1, quantity: 5, note: "No onions" });
    expect(addItem(noted, 1).slice(-1)[0]).toEqual({ key: 3, itemId: 1, quantity: 1 });
    expect(addItem(noted, 1)[0]?.note).toBe("No onions");
  });

  it("lets the same item carry two different notes (Nov 18, 2026)", () => {
    let fajitas: Draft = addItem(addItem([], 7), 7);
    fajitas = setItemNote(setItemNote(fajitas, 1, "No tomato"), 2, "No avocado");
    expect(fajitas.map((line) => [line.itemId, line.note])).toEqual([
      [7, "No tomato"],
      [7, "No avocado"],
    ]);
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
        { key: 1, itemId: 1, quantity: 1 },
        { key: 2, itemId: 2, quantity: 1 },
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

  it("adds a line for every tap, in the order they were added, and counts an item over its lines", () => {
    let draft: Draft = [];
    draft = addItem(draft, taco);
    draft = addItem(draft, combo);
    draft = addItem(draft, taco);
    expect(draft).toEqual([
      { key: 1, itemId: taco, quantity: 1 },
      { key: 2, itemId: combo, quantity: 1 },
      { key: 3, itemId: taco, quantity: 1 },
    ]);
    expect(quantityOf(draft, taco)).toBe(2);
    expect(quantityOf(setQuantity(draft, 1, 4), taco)).toBe(5); // + raises one line
  });

  it("keeps quantities between 1 and 99", () => {
    const draft: Draft = [{ key: 1, itemId: taco, quantity: 1 }];
    expect(setQuantity(draft, 1, 0)).toEqual([{ key: 1, itemId: taco, quantity: 1 }]);
    expect(setQuantity(draft, 1, 250)).toEqual([{ key: 1, itemId: taco, quantity: 99 }]);
  });

  it("removes one line, leaving the same item's other lines", () => {
    const draft: Draft = [
      { key: 1, itemId: taco, quantity: 3 },
      { key: 2, itemId: taco, quantity: 1 },
    ];
    expect(removeLine(draft, 1)).toEqual([{ key: 2, itemId: taco, quantity: 1 }]);
  });

  it("totals the lines: 2 tacos + 1 Combo #5 = $14.10", () => {
    const priced = priceDraft(
      [
        { key: 1, itemId: taco, quantity: 2 },
        { key: 2, itemId: combo, quantity: 1 },
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
    expect(priceDraft([{ key: 1, itemId: 999999, quantity: 1 }], () => undefined).lines).toEqual([]);
  });
});

describe("messages", () => {
  it("explains database refusals in plain words", () => {
    expect(menuErrorMessage({ message: "menu_item_not_found" })).toContain("no longer exists");
    expect(menuErrorMessage({ code: "23514", message: "x" })).toContain("isn't allowed");
    expect(menuErrorMessage({ message: "boom" })).toContain("couldn't be saved");
  });
});

describe("custom items", () => {
  const good = { name: " Birthday flan ", price: "4.50", quantity: "2", taxCategory: "food" };

  it("read a name, a price in dollars, a quantity, and a tax type", () => {
    expect(parseCustomItem(good)).toEqual({ ok: true, item: { name: "Birthday flan", priceCents: 450, taxCategory: "food" }, quantity: 2 });
  });

  it("allow $0.00, and keep money exact", () => {
    expect(parseCustomItem({ ...good, price: "0" })).toMatchObject({ ok: true, item: { priceCents: 0 } });
    expect(parseCustomItem({ ...good, price: "19.99" })).toMatchObject({ ok: true, item: { priceCents: 1999 } });
  });

  it("refuse negative, partial-cent, and non-number prices", () => {
    for (const price of ["-1", "1.999", "abc", "", "1,50"]) {
      expect(parseCustomItem({ ...good, price }).ok, price).toBe(false);
    }
  });

  it("refuse quantities that aren't 1 to 99", () => {
    for (const quantity of ["0", "100", "1.5", "-1", ""]) {
      expect(parseCustomItem({ ...good, quantity }).ok, quantity).toBe(false);
    }
  });

  it("refuse a blank or very long name", () => {
    expect(parseCustomItem({ ...good, name: "  " }).ok).toBe(false);
    expect(parseCustomItem({ ...good, name: "x".repeat(81) }).ok).toBe(false);
  });

  it("never guess the tax: a liquor item can't default to the food rate", () => {
    expect(parseCustomItem({ ...good, taxCategory: "" })).toMatchObject({ ok: false, message: expect.stringContaining("tax type") });
    expect(parseCustomItem({ ...good, taxCategory: "cocktail" })).toMatchObject({ ok: true, item: { taxCategory: "cocktail" } });
  });

  it("are lines of their own in the order, priced as typed", () => {
    let draft: Draft = addItem([], 5);
    draft = addCustomItem(draft, { name: "Flan", priceCents: 450, taxCategory: "food" }, 2);
    draft = addCustomItem(draft, { name: "Shot", priceCents: 700, taxCategory: "cocktail" }, 1);
    expect(new Set(draft.map((line) => line.key)).size).toBe(3);
    const priced = priceDraft(draft, (itemId, line) => (line.custom ? { name: line.custom.name, unitCents: line.custom.priceCents } : { name: "Menu", unitCents: 100 }));
    expect(priced.subtotalCents).toBe(100 + 900 + 700);
    expect(priced.itemCount).toBe(4);
    const shot = draft[2]!;
    expect(removeLine(draft, shot.key)).toHaveLength(2);
    expect(setQuantity(draft, shot.key, 3)[2]!.quantity).toBe(3);
  });
});

describe("the manager's menu forms", () => {
  it("a new item needs a name, a price in dollars, and a tax type; the description is optional", () => {
    expect(addMenuItemSchema.safeParse({ categoryId: 1, name: "  Birria tacos ", description: "", price: "12.50", taxCategory: "food" }).data).toEqual({
      categoryId: 1, name: "Birria tacos", description: "", price: 1250, taxCategory: "food",
    });
    expect(addMenuItemSchema.safeParse({ categoryId: 1, name: " ", description: "", price: "1", taxCategory: "food" }).error?.issues[0]?.message).toBe("Enter the item's name.");
    expect(addMenuItemSchema.safeParse({ categoryId: 1, name: "X", description: "", price: "1.234", taxCategory: "food" }).success).toBe(false);
    expect(addMenuItemSchema.safeParse({ categoryId: 1, name: "X", description: "", price: "1", taxCategory: "" }).error?.issues[0]?.message).toBe("Choose the tax type.");
    expect(addMenuItemSchema.safeParse({ categoryId: 1, name: "X", description: "d".repeat(401), price: "1", taxCategory: "food" }).success).toBe(false);
  });

  it("an edit carries everything the manager can change", () => {
    expect(editMenuItemSchema.safeParse({ id: 5, name: "Monterrey", description: "New", price: "11.50", taxCategory: "food", isAvailable: false }).data).toEqual({
      id: 5, name: "Monterrey", description: "New", price: 1150, taxCategory: "food", isAvailable: false,
    });
  });

  it("an option is a short label without brackets", () => {
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: " Shrimp " }).data).toEqual({ itemId: 5, label: "Shrimp", extra: 0 });
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "" }).success).toBe(false);
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "(Shrimp)" }).error?.issues[0]?.message).toBe("Leave out brackets: they are added for you.");
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "x".repeat(41) }).success).toBe(false);
  });

  it("an option may cost extra: dollars typed, cents saved, nothing for no extra charge (Nov 18, 2026)", () => {
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "Shrimp", extra: "3" }).data).toEqual({ itemId: 5, label: "Shrimp", extra: 300 });
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "Shrimp", extra: "$2.50" }).data?.extra).toBe(250);
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "Shrimp", extra: "3.005" }).error?.issues[0]?.message).toContain("Enter the extra charge like 3.00");
    expect(addMenuOptionSchema.safeParse({ itemId: 5, label: "Shrimp", extra: "1000.01" }).success).toBe(false);
    expect(setMenuOptionExtraSchema.safeParse({ optionId: 9, extra: "" }).data).toEqual({ optionId: 9, extra: 0 });
    expect(setMenuOptionExtraSchema.safeParse({ optionId: 9, extra: "4.50" }).data).toEqual({ optionId: 9, extra: 450 });
    expect([extraCents(""), extraCents("0"), extraCents("1000"), extraCents("abc")]).toEqual([0, 0, 100000, null]);
  });

  it("every option on the menu starts at no extra charge, at its item's price", () => {
    for (const parent of allItems) {
      for (const choice of parent.choices) expect([choice.extraCents, choice.priceCents]).toEqual([0, parent.priceCents]);
    }
  });

  it("explains each refusal in plain words", () => {
    expect(menuErrorMessage({ message: "name_taken" })).toContain("already has an item with that name");
    expect(menuErrorMessage({ message: "option_taken" })).toContain("already has that option");
    expect(menuErrorMessage({ message: "invalid_extra" })).toContain("extra charge from $0.00 to $1,000.00");
  });
});
