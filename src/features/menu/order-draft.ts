import { lineTotalCents } from "./money";
import type { TaxCategory } from "./types";

/**
 * The order a waiter is building on screen. Pure functions, so the screen and the tests share them.
 * Saving it adds its lines to the table's order.
 *
 * Every tap on a menu item adds a line of its own (owner decision, Nov 18, 2026), so two chicken fajitas can carry
 * different notes ("no tomato", "no avocado"). The + on a line raises that line's quantity instead.
 */

export const MAX_QUANTITY = 99;
export const ITEM_NOTE_MAX = 200;

/** An item typed by the waiter: saved only on this order, never added to the menu. */
export type CustomItem = { name: string; priceCents: number; taxCategory: TaxCategory };

/**
 * key identifies the line on this screen (the same item can be on several lines). itemId is the menu item, or 0
 * for a custom item, which carries what the waiter typed.
 */
export type DraftLine = { key: number; itemId: number; quantity: number; custom?: CustomItem; note?: string };
export type Draft = readonly DraftLine[];

const nextKey = (draft: Draft) => Math.max(0, ...draft.map((line) => line.key)) + 1;
const clampQuantity = (quantity: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)));

/** One tap: a new line of one, at the end of the order, even when the item is already on it. */
export function addItem(draft: Draft, itemId: number): Draft {
  return [...draft, { key: nextKey(draft), itemId, quantity: 1 }];
}

/** Adds a custom item as its own line. */
export function addCustomItem(draft: Draft, custom: CustomItem, quantity: number): Draft {
  return [...draft, { key: nextKey(draft), itemId: 0, quantity: clampQuantity(quantity), custom }];
}

/** Sets one line's quantity between 1 and 99 (use removeLine to take it off). */
export function setQuantity(draft: Draft, key: number, quantity: number): Draft {
  return draft.map((line) => (line.key === key ? { ...line, quantity: clampQuantity(quantity) } : line));
}

/** The note under one line, for the kitchen. */
export function setItemNote(draft: Draft, key: number, note: string): Draft {
  return draft.map((line) => (line.key === key ? { ...line, note } : line));
}

export function removeLine(draft: Draft, key: number): Draft {
  return draft.filter((line) => line.key !== key);
}

/** How many of a menu item the order has, over all its lines. */
export function quantityOf(draft: Draft, itemId: number): number {
  return draft.reduce((sum, line) => sum + (line.itemId === itemId && !line.custom ? line.quantity : 0), 0);
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
