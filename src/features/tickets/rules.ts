import { lineTotalCents } from "@/features/menu/money";
import type { Draft } from "@/features/menu/order-draft";

import type { TicketRow } from "./schema";
import type { SavedTicket, TicketStatus } from "./types";

/** Database row -> ticket for the screen. */
export function buildTicket(
  row: TicketRow,
  format: { dateTime: (iso: string) => string; clock: (iso: string) => string },
): SavedTicket {
  const lines = [...row.ticket_lines]
    .sort((a, b) => a.line_no - b.line_no)
    .map((line) => ({
      itemId: line.menu_item_id,
      name: line.item_name,
      unitCents: line.unit_price_cents,
      lateCents: line.late_surcharge_cents,
      quantity: line.quantity,
      totalCents: lineTotalCents(line.unit_price_cents, line.quantity),
      taxGroup: line.tax_group_code,
    }));
  return {
    id: row.id,
    number: row.ticket_number,
    visitId: row.visit_id,
    status: row.status,
    version: row.version,
    createdAt: format.dateTime(row.created_at),
    createdTime: format.clock(row.created_at),
    maker: { name: row.maker.full_name, number: row.maker.employee_number },
    lastEditor: row.editor ? { name: row.editor.full_name, number: row.editor.employee_number } : null,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
  };
}

export const STATUS_TEXT: Record<TicketStatus, string> = {
  open: "Not printed: can be changed",
  printed: "Printed",
  cancelled: "Cancelled",
};

/** The saved ticket as an editable order. */
export function draftFromTicket(ticket: Pick<SavedTicket, "lines"> | null): Draft {
  return ticket ? ticket.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })) : [];
}

/** True when the order on screen differs from what is saved (items, quantities, or order). */
export function hasUnsavedChanges(draft: Draft, saved: Draft): boolean {
  if (draft.length !== saved.length) return true;
  return draft.some((line, index) => line.itemId !== saved[index]?.itemId || line.quantity !== saved[index]?.quantity);
}

/** Saved name and price per item, so the order panel shows what the ticket really charges. */
export function savedPriceMap(ticket: Pick<SavedTicket, "lines"> | null): Map<number, { name: string; unitCents: number }> {
  return new Map((ticket?.lines ?? []).map((line) => [line.itemId, { name: line.name, unitCents: line.unitCents }]));
}

export function canEdit(ticket: Pick<SavedTicket, "status"> | null, visitOpen: boolean): boolean {
  return visitOpen && (ticket === null || ticket.status === "open");
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
