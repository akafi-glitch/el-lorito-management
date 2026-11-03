import { lineTotalCents } from "@/features/menu/money";
import type { Draft } from "@/features/menu/order-draft";

import type { TicketRow, TicketTotalsRow } from "./schema";
import type { KitchenState, SavedBatch, SavedLine, SavedTicket, TicketStatus } from "./types";

type Batch = TicketRow["ticket_batches"][number];

/** Where an order stands with the kitchen, from its print attempts (the latest answer decides). */
export function kitchenState(batch: Pick<Batch, "kitchen_printed_at" | "print_attempts">): KitchenState {
  if (batch.kitchen_printed_at !== null) return "printed";
  const latest = [...batch.print_attempts].sort((a, b) => b.attempt_no - a.attempt_no)[0];
  if (!latest) return "not-sent";
  return latest.outcome === "not_printed" ? "failed" : "waiting";
}

export const KITCHEN_TEXT: Record<KitchenState, string> = {
  "not-sent": "Not sent to the kitchen",
  waiting: "Kitchen receipt: no answer yet",
  failed: "Kitchen receipt didn't print",
  printed: "Sent to the kitchen",
};

/** What a table says: "saved" still needs a kitchen receipt, "printed" needs the customer receipt next. */
export type KitchenMark = "saved" | "printed";

export const KITCHEN_MARK_TEXT: Record<KitchenMark, string> = {
  saved: "Kitchen Receipt Saved",
  printed: "Kitchen Receipt Printed",
};

/** From whether each order with items has its kitchen receipt confirmed printed. */
export function kitchenMark(printed: readonly boolean[]): KitchenMark | null {
  if (printed.length === 0) return null;
  return printed.every(Boolean) ? "printed" : "saved";
}

export function ticketKitchenMark(ticket: Pick<SavedTicket, "batches"> | null): KitchenMark | null {
  return kitchenMark((ticket?.batches ?? []).filter((batch) => batch.lines.length > 0).map((batch) => batch.kitchen === "printed"));
}

/** Database row -> ticket for the screen. */
export function buildTicket(
  row: TicketRow,
  format: { dateTime: (iso: string) => string; clock: (iso: string) => string },
  totals: TicketTotalsRow,
): SavedTicket {
  if (totals.ticket_id !== row.id) throw new Error(`Totals for ticket ${totals.ticket_id} given for ticket ${row.id}`);
  const batches: SavedBatch[] = [...row.ticket_batches]
    .sort((a, b) => a.batch_no - b.batch_no)
    .map((batch) => ({
      id: batch.id,
      no: batch.batch_no,
      notes: batch.notes,
      waiterNumber: batch.waiter.employee_number,
      time: format.clock(batch.created_at),
      kitchen: kitchenState(batch),
      lines: [...batch.ticket_lines]
        .sort((a, b) => a.line_no - b.line_no)
        .map((line) => ({
          lineId: line.id,
          itemId: line.menu_item_id,
          isCustom: line.is_custom,
          name: line.item_name,
          unitCents: line.unit_price_cents,
          lateCents: line.late_surcharge_cents,
          quantity: line.quantity,
          totalCents: lineTotalCents(line.unit_price_cents, line.quantity),
          taxGroup: line.tax_group_code,
          notes: line.notes,
        })),
    }));
  const lines = batches.flatMap((batch) => batch.lines);
  return {
    id: row.id,
    number: row.ticket_number,
    status: row.status,
    version: row.version,
    isActive: !row.legacy_single_order,
    createdAt: format.dateTime(row.created_at),
    createdTime: format.clock(row.created_at),
    maker: { name: row.maker.full_name, number: row.maker.employee_number },
    lastEditor: row.editor ? { name: row.editor.full_name, number: row.editor.employee_number } : null,
    batches,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    totals: {
      foodSubtotalCents: totals.food_subtotal_cents,
      liquorSubtotalCents: totals.liquor_subtotal_cents,
      foodTaxCents: totals.food_tax_cents,
      liquorTaxCents: totals.liquor_tax_cents,
      totalCents: totals.total_cents,
      rates: { food: totals.food_rate_bp, liquor: totals.liquor_rate_bp },
    },
  };
}

export const STATUS_TEXT: Record<TicketStatus, string> = {
  open: "Open: orders can still change",
  printed: "Printed",
  cancelled: "Cancelled",
  finalized: "Finalized",
};

/**
 * The ticket this table's page works on: its open ticket. Null when nothing is on the table right now,
 * including right after a customer receipt finalized the last one: the next order starts a new ticket.
 */
export function currentTicket(tickets: readonly SavedTicket[]): SavedTicket | null {
  return tickets.find((ticket) => ticket.status === "open" && ticket.isActive) ?? null;
}

/** Orders that still need to go to the kitchen: they have items and no print confirmed or awaited. */
export function batchesToSend(ticket: Pick<SavedTicket, "batches"> | null): SavedBatch[] {
  return (ticket?.batches ?? []).filter((batch) => batch.lines.length > 0 && (batch.kitchen === "not-sent" || batch.kitchen === "failed"));
}

/** What the screen sends to save the order being built. */
export function orderLinesFromDraft(draft: Draft) {
  return draft.map((line) =>
    line.custom
      ? { name: line.custom.name, priceCents: line.custom.priceCents, taxCategory: line.custom.taxCategory, quantity: line.quantity, notes: line.note ?? null }
      : { itemId: line.itemId, quantity: line.quantity, notes: line.note ?? null },
  );
}

/** Adds (or removes, with null) "ticket=1001" on a table page link, keeping its other settings. */
export function withTicket(tableHref: string, ticketNumber: number | null): string {
  const [path, query = ""] = tableHref.split("?", 2) as [string, string?];
  const params = new URLSearchParams(query);
  if (ticketNumber === null) params.delete("ticket");
  else params.set("ticket", String(ticketNumber));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function staffLabel(staff: { name: string; number: string }): string {
  return `${staff.name} (${staff.number})`;
}

export type { SavedLine };
