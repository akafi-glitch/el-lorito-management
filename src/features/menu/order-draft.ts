import { lineTotalCents } from "./money";

/**
 * The order a waiter is building on screen. Pure functions, so the screen and the tests share them.
 * Phase 7 saves it as a ticket.
 */

export const MAX_QUANTITY = 99;

export type DraftLine = { itemId: number; quantity: number };
export type Draft = readonly DraftLine[];

/** Adds one; a new item goes to the end of the order. */
export function addItem(draft: Draft, itemId: number): Draft {
  const existing = draft.find((line) => line.itemId === itemId);
  if (!existing) return [...draft, { itemId, quantity: 1 }];
  return setQuantity(draft, itemId, existing.quantity + 1);
}

/** Sets a quantity between 1 and 99 (use removeItem to take a line off). */
export function setQuantity(draft: Draft, itemId: number, quantity: number): Draft {
  const clamped = Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)));
  return draft.map((line) => (line.itemId === itemId ? { ...line, quantity: clamped } : line));
}

export function removeItem(draft: Draft, itemId: number): Draft {
  return draft.filter((line) => line.itemId !== itemId);
}

export function quantityOf(draft: Draft, itemId: number): number {
  return draft.find((line) => line.itemId === itemId)?.quantity ?? 0;
}

export type PricedLine = DraftLine & { name: string; unitCents: number; totalCents: number };

/** Prices each line with the given price lookup; lines whose item vanished are dropped. */
export function priceDraft(
  draft: Draft,
  lookup: (itemId: number) => { name: string; unitCents: number } | undefined,
): { lines: PricedLine[]; itemCount: number; subtotalCents: number } {
  const lines: PricedLine[] = [];
  for (const line of draft) {
    const item = lookup(line.itemId);
    if (!item) continue;
    lines.push({ ...line, name: item.name, unitCents: item.unitCents, totalCents: lineTotalCents(item.unitCents, line.quantity) });
  }
  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
  };
}
