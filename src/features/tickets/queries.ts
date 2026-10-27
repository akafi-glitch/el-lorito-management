import "server-only";

import { z } from "zod";

import { formatClock, formatTime } from "@/features/staff/queries";
import { createAdminClient } from "@/lib/supabase/admin";

import { buildTicket } from "./rules";
import { ticketRowSchema, ticketTotalsRowSchema } from "./schema";
import type { SavedTicket } from "./types";

const SELECT = `id, ticket_number, visit_id, status, version, created_at,
  maker:employees!tickets_employee_id_fkey(full_name, employee_number),
  editor:employees!tickets_last_edited_by_employee_id_fkey(full_name, employee_number),
  ticket_lines(line_no, menu_item_id, item_name, unit_price_cents, late_surcharge_cents, quantity, tax_group_code)`;

/** Every ticket of one visit (one group at a table), oldest first, with totals from the database. */
export async function loadVisitTickets(visitId: number): Promise<SavedTicket[]> {
  const db = createAdminClient();
  const [tickets, totals] = await Promise.all([
    db.from("tickets").select(SELECT).eq("visit_id", visitId).order("ticket_number"),
    db
      .from("ticket_totals")
      .select("ticket_id, food_subtotal_cents, liquor_subtotal_cents, food_rate_bp, liquor_rate_bp, food_tax_cents, liquor_tax_cents, total_cents")
      .eq("visit_id", visitId),
  ]);
  if (tickets.error) throw new Error(`Could not load the tickets: ${tickets.error.message}`);
  if (totals.error) throw new Error(`Could not load the ticket totals: ${totals.error.message}`);
  const byTicket = new Map(z.array(ticketTotalsRowSchema).parse(totals.data).map((row) => [row.ticket_id, row]));
  return z
    .array(ticketRowSchema)
    .parse(tickets.data)
    .map((row) => {
      const rowTotals = byTicket.get(row.id);
      if (!rowTotals) throw new Error(`Totals missing for ticket ${row.ticket_number}`);
      return buildTicket(row, { dateTime: formatTime, clock: formatClock }, rowTotals);
    });
}
