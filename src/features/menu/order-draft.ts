import { lineTotalCents } from "./money";
import type { TaxCategory } from "./types";

/**
 * The order a waiter is building on screen. Pure functions, so the screen and the tests share them.
 * Saving it adds one order to the table's ticket.
 */

export const MAX_QUANTITY = 99;
export const ITEM_NOTE_MAX = 200;

/** An item typed by the waiter: saved only on this order, never added to the menu. */
export type CustomItem = { name: string; priceCents: number; taxCategory: TaxCategory };

/** itemId is the menu item, or a negative number that only identifies a custom line on this screen. */
export type DraftLine = { itemId: number; quantity: number; custom?: CustomItem; note?: string };
export type Draft = readonly DraftLine[];

/** Adds one; a new item goes to the end of the order. */
export function addItem(draft: Draft, itemId: number): Draft {
  const existing = draft.find((line) => line.itemId === itemId);
  if (!existing) return [...draft, { itemId, quantity: 1 }];
  return setQuantity(draft, itemId, existing.quantity + 1);
}

/** Adds a custom item as its own line. */
export function addCustomItem(draft: Draft, custom: CustomItem, quantity: number): Draft {
  const itemId = Math.min(0, ...draft.map((line) => line.itemId)) - 1;
  return [...draft, { itemId, quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity))), custom }];
}

/** Sets a quantity between 1 and 99 (use removeItem to take a line off). */
export function setQuantity(draft: Draft, itemId: number, quantity: number): Draft {
  const clamped = Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)));
  return draft.map((line) => (line.itemId === itemId ? { ...line, quantity: clamped } : line));
}

/** The note under one item, for the kitchen. */
export function setItemNote(draft: Draft, itemId: number, note: string): Draft {
  return draft.map((line) => (line.itemId === itemId ? { ...line, note } : line));
}

export function removeItem(draft: Draft, itemId: number): Draft {
  return draft.filter((line) => line.itemId !== itemId);
}

export function quantityOf(draft: Draft, itemId: number): number {
  return draft.find((line) => line.itemId === itemId)?.quantity ?? 0;
}

export type PricedLine<T extends { name: string; unitCents: number } = { name: string; unitCents: number }> = DraftLine &
  T & { totalCents: number };

/** Prices each line with the given lookup (which may add more, such as the tax group); lines whose item vanished are dropped. */
export function priceDraft<T extends { name: string; unitCents: number }>(
  draft: Draft,
  lookup: (itemId: number, line: DraftLine) => T | undefined,
): { lines: PricedLine<T>[]; itemCount: number; subtotalCents: number } {
  const lines: PricedLine<T>[] = [];
  for (const line of draft) {
    const item = lookup(line.itemId, line);
    if (!item) continue;
    lines.push({ ...item, ...line, totalCents: lineTotalCents(item.unitCents, line.quantity) });
  }
  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
  };
}
