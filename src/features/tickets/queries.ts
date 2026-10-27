import "server-only";

import { z } from "zod";

import { formatClock, formatTime } from "@/features/staff/queries";
import { createAdminClient } from "@/lib/supabase/admin";

import { buildTicket } from "./rules";
import { ticketRowSchema } from "./schema";
import type { SavedTicket } from "./types";

const SELECT = `id, ticket_number, visit_id, status, version, created_at,
  maker:employees!tickets_employee_id_fkey(full_name, employee_number),
  editor:employees!tickets_last_edited_by_employee_id_fkey(full_name, employee_number),
  ticket_lines(line_no, menu_item_id, item_name, unit_price_cents, late_surcharge_cents, quantity, tax_group_code)`;

/** Every ticket of one visit (one group at a table), oldest first. */
export async function loadVisitTickets(visitId: number): Promise<SavedTicket[]> {
  const { data, error } = await createAdminClient()
    .from("tickets")
    .select(SELECT)
    .eq("visit_id", visitId)
    .order("ticket_number");
  if (error) throw new Error(`Could not load the tickets: ${error.message}`);
  return z
    .array(ticketRowSchema)
    .parse(data)
    .map((row) => buildTicket(row, { dateTime: formatTime, clock: formatClock }));
}
