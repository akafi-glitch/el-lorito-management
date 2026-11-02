import { MAX_PRICE_CENTS, parseDollars } from "./money";
import { MAX_QUANTITY, type CustomItem } from "./order-draft";
import { TAX_CATEGORIES } from "./schema";
import type { TaxCategory } from "./types";

export const CUSTOM_NAME_MAX = 80;

export type CustomItemInput = { name: string; price: string; quantity: string; taxCategory: string };

export type CustomItemResult = { ok: true; item: CustomItem; quantity: number } | { ok: false; message: string };

/** Checks what the waiter typed. Money is read as text, so no floating-point step is involved. */
export function parseCustomItem(input: CustomItemInput): CustomItemResult {
  const name = input.name.trim();
  if (name === "") return { ok: false, message: "Enter the item's name." };
  if (name.length > CUSTOM_NAME_MAX) return { ok: false, message: `Use ${CUSTOM_NAME_MAX} characters or fewer for the name.` };

  const priceCents = parseDollars(input.price);
  if (priceCents === null) {
    return { ok: false, message: `Enter a price like 8.50, from 0.00 up to ${MAX_PRICE_CENTS / 100}.` };
  }

  const quantity = /^\d{1,2}$/.test(input.quantity.trim()) ? Number(input.quantity.trim()) : 0;
  if (quantity < 1 || quantity > MAX_QUANTITY) return { ok: false, message: `Enter a quantity from 1 to ${MAX_QUANTITY}.` };

  if (!(TAX_CATEGORIES as readonly string[]).includes(input.taxCategory)) {
    return { ok: false, message: "Choose the tax type: food, nonalcoholic drink, beer, or cocktail." };
  }
  return { ok: true, item: { name, priceCents, taxCategory: input.taxCategory as TaxCategory }, quantity };
}
