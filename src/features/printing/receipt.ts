import type { Totals } from "@/features/billing/tax";
import { formatCents } from "@/features/menu/money";

import type { CustomerSnapshot, KitchenBatchRow } from "./schema";

/** Everything printed on a customer bill. Comes from the bill the database stored for the attempt. */
export type ReceiptData = {
  restaurantName: string;
  ticketNumber: number;
  /** "X2", or "X6 + X7 + X8" for joined tables. */
  tables: string;
  /** Owner decision: the waiter's number only. */
  waiterNumber: string;
  /** In the restaurant's time zone. */
  printedAt: string;
  lines: { name: string; quantity: number; unitCents: number; totalCents: number }[];
  totals: Totals;
};

/** Everything printed for the kitchen. Deliberately has no place for a price. */
export type KitchenReceiptData = {
  title: string;
  ticketNumber: number;
  orderNumber: number;
  tables: string;
  waiterNumber: string;
  time: string;
  /** Another copy of an order already requested: the kitchen must not cook it twice. */
  isReprint: boolean;
  lines: KitchenLine[];
  notes: string | null;
};

/** Where an item goes on the kitchen receipt (owner decision, Nov 10, 2026): food first, then drinks, then appetizers. */
export type KitchenGroup = "food" | "drinks" | "appetizers";
export type KitchenLine = { name: string; quantity: number; note: string | null; group: KitchenGroup };

export const KITCHEN_GROUP_ORDER: readonly KitchenGroup[] = ["food", "drinks", "appetizers"];
export const KITCHEN_GROUP_TITLE: Record<KitchenGroup, string | null> = { food: null, drinks: "DRINKS", appetizers: "APPETIZERS" };

const DRINK_CATEGORIES = new Set(["soft-drinks", "other-beverages", "aguas-frescas", "jarritos-bottled-drinks", "beer", "cocktails"]);

/** By the menu's category. A custom item has none, so liquor tax makes it a drink. */
export function kitchenGroup(categoryCode: string | null | undefined, taxGroup: "food" | "liquor"): KitchenGroup {
  if (categoryCode === "appetizers") return "appetizers";
  if (categoryCode ? DRINK_CATEGORIES.has(categoryCode) : taxGroup === "liquor") return "drinks";
  return "food";
}

/** The lines in the order the kitchen reads them: each group together, keeping the order they were added in. */
export function groupKitchenLines(lines: readonly KitchenLine[]): { group: KitchenGroup; title: string | null; lines: KitchenLine[] }[] {
  return KITCHEN_GROUP_ORDER.map((group) => ({ group, title: KITCHEN_GROUP_TITLE[group], lines: lines.filter((line) => line.group === group) })).filter(
    (section) => section.lines.length > 0,
  );
}

export const RESTAURANT = { name: "EL LORITO", kitchenTitle: "EL LORITO — KITCHEN" } as const;

/** Printable width inside the paper's margins: 80 mm paper -> 72 mm, 58 mm paper -> 48 mm. */
export function printableWidthMm(paperWidthMm: 58 | 80): number {
  return paperWidthMm === 80 ? 72 : 48;
}

/** Stored bill -> receipt. Nothing is worked out again: this is what the database kept. */
export function receiptFromSnapshot(snapshot: CustomerSnapshot, formatTime: (iso: string) => string): ReceiptData {
  return {
    restaurantName: RESTAURANT.name,
    ticketNumber: snapshot.ticket_number,
    tables: snapshot.tables,
    waiterNumber: snapshot.waiter_number,
    printedAt: formatTime(snapshot.printed_at),
    lines: snapshot.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitCents: line.unit_cents,
      totalCents: line.total_cents,
    })),
    totals: {
      foodSubtotalCents: snapshot.totals.food_subtotal_cents,
      liquorSubtotalCents: snapshot.totals.liquor_subtotal_cents,
      foodTaxCents: snapshot.totals.food_tax_cents,
      liquorTaxCents: snapshot.totals.liquor_tax_cents,
      totalCents: snapshot.totals.total_cents,
      rates: { food: snapshot.totals.food_rate_bp, liquor: snapshot.totals.liquor_rate_bp },
    },
  };
}

/** The kitchen reads Spanish only (owner decision, Nov 7, 2026): "COMBINACIÓN #5". A custom item has none, so it keeps its name. */
export function kitchenItemName(name: string, nameEs: string | null | undefined): string {
  return (nameEs?.trim() || name).toUpperCase();
}

/** One order -> one kitchen receipt: only this order's items, capitals for reading across a kitchen. */
export function kitchenReceiptFromRow(row: KitchenBatchRow, isReprint: boolean, time: string): KitchenReceiptData {
  return {
    title: RESTAURANT.kitchenTitle,
    ticketNumber: row.ticket.ticket_number,
    orderNumber: row.batch_no,
    tables: (row.ticket.visit ? row.ticket.visit.visit_tables.map((vt) => vt.restaurant_tables) : [row.ticket.own_table])
      .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }))
      .map((table) => table.label)
      .join(" + ")
      .toUpperCase(),
    waiterNumber: row.waiter.employee_number,
    time,
    isReprint,
    lines: [...row.ticket_lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((line) => ({
        name: kitchenItemName(line.item_name, line.menu_item?.name_es),
        quantity: line.quantity,
        note: line.notes?.toUpperCase() ?? null,
        group: kitchenGroup(line.menu_item?.category?.code, line.tax_group_code),
      })),
    notes: row.notes?.toUpperCase() ?? null,
  };
}

/** The amount printed in a receipt's right column, without the dollar sign. */
export function receiptAmount(cents: number): string {
  return formatCents(cents).replace("$", "");
}
