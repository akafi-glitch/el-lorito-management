import { lineTotalCents } from "@/features/menu/money";
import type { Totals } from "@/features/billing/tax";

import type { ReceiptRow } from "./schema";

/** Everything printed on a customer ticket. Built from the database after printing is recorded. */
export type ReceiptData = {
  restaurantName: string;
  restaurantSubtitle: string;
  ticketNumber: number;
  /** "X2", or "X6 + X7 + X8" for joined tables. */
  tables: string;
  /** Owner decision: the waiter's number only. */
  waiterNumber: string;
  /** When the ticket was first printed, in the restaurant's time zone. */
  printedAt: string;
  lines: { name: string; quantity: number; unitCents: number; totalCents: number }[];
  totals: Totals;
};

export const RESTAURANT = { name: "EL LORITO", subtitle: "Mexican Restaurant" } as const;

export type ReceiptSource = {
  ticketNumber: number;
  tableLabels: string[];
  waiterNumber: string;
  printedAt: string;
  lines: { name: string; quantity: number; unitCents: number }[];
  totals: Totals;
};

export function buildReceipt(source: ReceiptSource): ReceiptData {
  return {
    restaurantName: RESTAURANT.name,
    restaurantSubtitle: RESTAURANT.subtitle,
    ticketNumber: source.ticketNumber,
    tables: source.tableLabels.join(" + "),
    waiterNumber: source.waiterNumber,
    printedAt: source.printedAt,
    lines: source.lines.map((line) => ({ ...line, totalCents: lineTotalCents(line.unitCents, line.quantity) })),
    totals: source.totals,
  };
}

/** Printable width inside the paper's margins: 80 mm paper -> 72 mm, 58 mm paper -> 48 mm. */
export function printableWidthMm(paperWidthMm: 58 | 80): number {
  return paperWidthMm === 80 ? 72 : 48;
}

/** Database row -> receipt: tables in floor order, lines in ticket order, frozen totals. */
export function receiptFromRow(row: ReceiptRow, formatTime: (iso: string) => string): ReceiptData {
  return buildReceipt({
    ticketNumber: row.ticket_number,
    tableLabels: [...row.visit.visit_tables]
      .map((vt) => vt.restaurant_tables)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((table) => table.label),
    waiterNumber: row.maker.employee_number,
    printedAt: formatTime(row.printed_at),
    lines: [...row.ticket_lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((line) => ({ name: line.item_name, quantity: line.quantity, unitCents: line.unit_price_cents })),
    totals: {
      foodSubtotalCents: row.food_subtotal_cents,
      liquorSubtotalCents: row.liquor_subtotal_cents,
      foodTaxCents: row.food_tax_cents,
      liquorTaxCents: row.liquor_tax_cents,
      totalCents: row.total_cents,
      rates: { food: row.food_rate_bp, liquor: row.liquor_rate_bp },
    },
  });
}
