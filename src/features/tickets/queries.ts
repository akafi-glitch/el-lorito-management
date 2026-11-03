import "server-only";

import { z } from "zod";

import { formatClock, formatTime } from "@/features/staff/queries";
import { requirePinSession } from "@/features/pin/session";
import { createAdminClient } from "@/lib/supabase/admin";

import { buildTicket } from "./rules";
import { ticketRowSchema, ticketTotalsRowSchema } from "./schema";
import type { SavedTicket } from "./types";

const SELECT = `id, ticket_number, status, version, legacy_single_order, created_at, finalized_at,
  maker:employees!tickets_employee_id_fkey(full_name, employee_number),
  editor:employees!tickets_last_edited_by_employee_id_fkey(full_name, employee_number),
  ticket_batches(id, batch_no, notes, created_at, kitchen_printed_at,
    waiter:employees!ticket_batches_employee_id_fkey(employee_number),
    print_attempts(attempt_no, outcome),
    ticket_lines(id, line_no, menu_item_id, is_custom, item_name, unit_price_cents, late_surcharge_cents, quantity, tax_group_code, notes))`;

const TOTALS = "ticket_id, food_subtotal_cents, liquor_subtotal_cents, food_rate_bp, liquor_rate_bp, food_tax_cents, liquor_tax_cents, total_cents";

function build(rows: unknown, totals: unknown): SavedTicket[] {
  const byTicket = new Map(z.array(ticketTotalsRowSchema).parse(totals).map((row) => [row.ticket_id, row]));
  return z
    .array(ticketRowSchema)
    .parse(rows)
    .map((row) => {
      const rowTotals = byTicket.get(row.id);
      if (!rowTotals) throw new Error(`Totals missing for ticket ${row.ticket_number}`);
      return buildTicket(row, { dateTime: formatTime, clock: formatClock }, rowTotals);
    });
}

/**
 * A table's current ticket and its earlier tickets from the open shift, oldest first, with totals from
 * the database. Older ones are in Management's Order History, so the table reads as fresh.
 */
export async function loadTableTickets(tableId: string): Promise<SavedTicket[]> {
  const db = createAdminClient();
  const shift = await db.from("shifts").select("id").is("ended_at", null).maybeSingle();
  if (shift.error) throw new Error(`Could not load the shift: ${shift.error.message}`);
  const current = "and(status.eq.open,legacy_single_order.eq.false)";
  const tickets = await db
    .from("tickets")
    .select(SELECT)
    .eq("table_id", tableId)
    .or(shift.data ? `${current},shift_id.eq.${shift.data.id}` : current)
    .order("ticket_number");
  if (tickets.error) throw new Error(`Could not load the tickets: ${tickets.error.message}`);
  const ids = tickets.data.map((ticket) => ticket.id);
  if (ids.length === 0) return [];
  const totals = await db.from("ticket_totals").select(TOTALS).in("ticket_id", ids);
  if (totals.error) throw new Error(`Could not load the ticket totals: ${totals.error.message}`);
  return build(tickets.data, totals.data);
}

/** One ticket by its number, for Management. Null when there is none. */
export async function loadTicketByNumber(ticketNumber: number): Promise<SavedTicket | null> {
  await requirePinSession();
  const db = createAdminClient();
  const [tickets, totals] = await Promise.all([
    db.from("tickets").select(SELECT).eq("ticket_number", ticketNumber),
    db.from("ticket_totals").select(TOTALS).eq("ticket_number", ticketNumber),
  ]);
  if (tickets.error) throw new Error(`Could not load the ticket: ${tickets.error.message}`);
  if (totals.error) throw new Error(`Could not load the ticket totals: ${totals.error.message}`);
  return build(tickets.data, totals.data)[0] ?? null;
}
