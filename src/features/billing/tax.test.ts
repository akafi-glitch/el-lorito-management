import { describe, expect, it } from "vitest";

import { buildTaxSetup } from "./setup";
import { computeTotals, formatRate, taxCents } from "./tax";

const RATES = { food: 850, liquor: 1050 } as const;

/** Same examples as supabase/tests/ticket_totals.test.sql, so the app and the database agree. */
describe("one tax amount, rounded half up to the cent", () => {
  it.each([
    [750, 850, 64, "$7.50 food: $0.6375 -> $0.64"],
    [525, 1050, 55, "$5.25 liquor: $0.55125 -> $0.55"],
    [100, 850, 9, "exactly half a cent rounds up: $0.085 -> $0.09"],
    [100, 1050, 11, "exactly half a cent rounds up: $0.105 -> $0.11"],
    [1, 850, 0, "1 cent of food has no tax"],
    [0, 850, 0, "nothing costs nothing"],
    [2379, 850, 202, "$23.79 food: $2.02215 -> $2.02"],
    [1_089_000_000, 1050, 114_345_000, "large amounts stay exact"],
  ])("%i cents at %i bp = %i cents (%s)", (subtotal, rate, expected) => {
    expect(taxCents(subtotal, rate)).toBe(expected);
  });

  it("refuses negative or fractional money and impossible rates", () => {
    expect(() => taxCents(-1, 850)).toThrow();
    expect(() => taxCents(1.5, 850)).toThrow();
    expect(() => taxCents(100, 10_001)).toThrow();
  });
});

describe("ticket totals", () => {
  it("the owner's example: $7.50 food + $5.25 beer = $13.94", () => {
    expect(
      computeTotals(
        [
          { totalCents: 750, taxGroup: "food" },
          { totalCents: 525, taxGroup: "liquor" },
        ],
        RATES,
      ),
    ).toEqual({
      foodSubtotalCents: 750,
      liquorSubtotalCents: 525,
      foodTaxCents: 64,
      liquorTaxCents: 55,
      totalCents: 1394,
      rates: RATES,
    });
  });

  it("adds food and nonalcoholic drinks together, beer and cocktails together (database example)", () => {
    // 2 x Combo #5 ($18.80) + horchata ($3.25) | domestic beer ($4.99) + margarita ($6.99)
    const totals = computeTotals(
      [
        { totalCents: 1880, taxGroup: "food" },
        { totalCents: 499, taxGroup: "liquor" },
        { totalCents: 699, taxGroup: "liquor" },
        { totalCents: 325, taxGroup: "food" },
      ],
      RATES,
    );
    expect(totals).toMatchObject({ foodSubtotalCents: 2205, liquorSubtotalCents: 1198, foodTaxCents: 187, liquorTaxCents: 126, totalCents: 3716 });
  });

  it("rounds each tax once on its subtotal, not per line", () => {
    // Three $1.00 food lines: per line would be 3 x $0.09 = $0.27; on the subtotal it is $0.255 -> $0.26.
    const lines = [100, 100, 100].map((totalCents) => ({ totalCents, taxGroup: "food" as const }));
    expect(computeTotals(lines, RATES).foodTaxCents).toBe(26);
  });

  it("a food-only and a liquor-only ticket", () => {
    expect(computeTotals([{ totalCents: 705, taxGroup: "food" }], RATES)).toMatchObject({ liquorTaxCents: 0, totalCents: 765 });
    expect(computeTotals([{ totalCents: 1150, taxGroup: "liquor" }], RATES)).toMatchObject({ foodTaxCents: 0, liquorTaxCents: 121, totalCents: 1271 });
  });

  it("an empty order totals $0.00", () => {
    expect(computeTotals([], RATES).totalCents).toBe(0);
  });

  it("total always equals the four parts", () => {
    for (const food of [0, 1, 99, 1234, 98765]) {
      for (const liquor of [0, 5, 525, 4321]) {
        const t = computeTotals(
          [
            { totalCents: food, taxGroup: "food" },
            { totalCents: liquor, taxGroup: "liquor" },
          ],
          RATES,
        );
        expect(t.totalCents).toBe(t.foodSubtotalCents + t.liquorSubtotalCents + t.foodTaxCents + t.liquorTaxCents);
      }
    }
  });
});

describe("tax setup from the database", () => {
  const groups = [
    { code: "food" as const, rate_bp: 850 },
    { code: "liquor" as const, rate_bp: 1050 },
  ];
  const categories = [
    { code: "food" as const, tax_group_code: "food" as const },
    { code: "nonalcoholic" as const, tax_group_code: "food" as const },
    { code: "beer" as const, tax_group_code: "liquor" as const },
    { code: "cocktail" as const, tax_group_code: "liquor" as const },
  ];

  it("maps each tax category to its group and rate", () => {
    expect(buildTaxSetup(groups, categories)).toEqual({
      rates: { food: 850, liquor: 1050 },
      groupOf: { food: "food", nonalcoholic: "food", beer: "liquor", cocktail: "liquor" },
    });
  });

  it("never guesses a missing rate or category", () => {
    expect(() => buildTaxSetup(groups.slice(0, 1), categories)).toThrow("Tax group liquor is missing");
    expect(() => buildTaxSetup(groups, categories.slice(0, 3))).toThrow("Tax category cocktail is missing");
  });

  it("shows rates the way the ticket prints them", () => {
    expect(formatRate(850)).toBe("8.5%");
    expect(formatRate(1050)).toBe("10.5%");
    expect(formatRate(700)).toBe("7%");
    expect(formatRate(825)).toBe("8.25%");
  });
});
