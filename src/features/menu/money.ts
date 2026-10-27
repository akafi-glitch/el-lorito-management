/**
 * Money is whole cents everywhere (integers), so adding prices never picks up floating-point
 * errors. Dollars appear only when showing or typing a price.
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 825 -> "$8.25". */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Money must be whole cents, got ${cents}`);
  return usd.format(cents / 100);
}

/** Highest price an item may have: $10,000.00. */
export const MAX_PRICE_CENTS = 1_000_000;

/**
 * "8.25", "$8.25", "8.2", "8" -> cents. Null for anything else (no rounding guesses: "8.255" is refused).
 * Reads the digits as text, so no floating-point step is involved.
 */
export function parseDollars(raw: string): number | null {
  const match = /^\$?\s*(\d{1,5})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= MAX_PRICE_CENTS ? cents : null;
}

/** price x quantity, checked to stay a safe whole number. */
export function lineTotalCents(unitCents: number, quantity: number): number {
  const total = unitCents * quantity;
  if (!Number.isSafeInteger(total)) throw new Error("Line total out of range");
  return total;
}
