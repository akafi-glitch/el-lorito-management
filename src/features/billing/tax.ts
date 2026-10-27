/**
 * Tax and totals (owner rules; rounding approved Oct 27, 2026). Mirrors public.tax_cents and the
 * public.ticket_totals view; both are tested with the same examples.
 *
 *   Food tax   = round_half_up(food subtotal x food rate)       food rate 8.5% (850 basis points)
 *   Liquor tax = round_half_up(liquor subtotal x liquor rate)   liquor rate 10.5% (1050)
 *   Total      = food subtotal + liquor subtotal + food tax + liquor tax
 *
 * Whole cents and integer arithmetic only; each tax is rounded once, on its subtotal.
 */

export const TAX_GROUPS = ["food", "liquor"] as const;
export type TaxGroup = (typeof TAX_GROUPS)[number];

/** Basis points per tax group: 850 = 8.5%. Loaded from the database. */
export type TaxRates = Readonly<Record<TaxGroup, number>>;

/** One tax amount in cents, rounded half up: (cents x rate + 5000) / 10000. */
export function taxCents(subtotalCents: number, rateBp: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new Error(`Subtotal must be whole cents ≥ 0, got ${subtotalCents}`);
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000) throw new Error(`Rate must be 0–10000 basis points, got ${rateBp}`);
  const scaled = BigInt(subtotalCents) * BigInt(rateBp) + 5000n;
  return Number(scaled / 10000n);
}

export type Totals = {
  foodSubtotalCents: number;
  liquorSubtotalCents: number;
  foodTaxCents: number;
  liquorTaxCents: number;
  totalCents: number;
  rates: TaxRates;
};

/** Totals of any set of lines (each line's total already in cents). */
export function computeTotals(lines: readonly { totalCents: number; taxGroup: TaxGroup }[], rates: TaxRates): Totals {
  let food = 0;
  let liquor = 0;
  for (const line of lines) {
    if (line.taxGroup === "food") food += line.totalCents;
    else liquor += line.totalCents;
  }
  const foodTax = taxCents(food, rates.food);
  const liquorTax = taxCents(liquor, rates.liquor);
  return {
    foodSubtotalCents: food,
    liquorSubtotalCents: liquor,
    foodTaxCents: foodTax,
    liquorTaxCents: liquorTax,
    totalCents: food + liquor + foodTax + liquorTax,
    rates,
  };
}

/** 850 -> "8.5%", 1050 -> "10.5%", 700 -> "7%". */
export function formatRate(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100);
  const rest = String(rateBp % 100).padStart(2, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}%` : `${whole}%`;
}
