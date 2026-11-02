import "server-only";

import { z } from "zod";

import { formatTime } from "@/features/staff/queries";
import { createAdminClient } from "@/lib/supabase/admin";

import { HISTORY_PAGE_SIZE, historyRowSchema, type HistoryFilters, type HistoryRow } from "./rules";

export type HistoryPage = { rows: HistoryRow[]; hasMore: boolean };
export type ShiftOption = { id: number; label: string };

const shiftRow = z.object({ id: z.number().int().positive(), started_at: z.string() });

/** One page of the history. Totals are what the tickets saved, never current menu prices. */
export async function loadHistory(filters: HistoryFilters): Promise<HistoryPage> {
  let query = createAdminClient()
    .from("ticket_history")
    .select("ticket_id, ticket_number, created_at, status, shift_id, shift_started_at, employee_number, table_labels, total_cents");
  if (filters.shiftId !== null) query = query.eq("shift_id", filters.shiftId);
  if (filters.waiterNumber !== null) query = query.eq("employee_number", filters.waiterNumber);
  const from = (filters.page - 1) * HISTORY_PAGE_SIZE;
  const { data, error } = await query
    .order("created_at", { ascending: filters.oldestFirst })
    .order("ticket_number", { ascending: filters.oldestFirst })
    .range(from, from + HISTORY_PAGE_SIZE); // one extra row says whether there is a next page
  if (error) throw new Error(`Could not load the order history: ${error.message}`);

  const rows = z.array(historyRowSchema).parse(data);
  return {
    hasMore: rows.length > HISTORY_PAGE_SIZE,
    rows: rows.slice(0, HISTORY_PAGE_SIZE).map((row) => ({
      ticketNumber: row.ticket_number,
      time: formatTime(row.created_at),
      shift: row.shift_started_at ? formatTime(row.shift_started_at) : "No shift",
      waiterNumber: row.employee_number,
      tables: row.table_labels ?? "",
      totalCents: row.total_cents,
      status: row.status,
    })),
  };
}

/** The most recent shifts, for the filter. */
export async function loadShiftOptions(): Promise<ShiftOption[]> {
  const { data, error } = await createAdminClient().from("shifts").select("id, started_at").order("started_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not load the shifts: ${error.message}`);
  return z
    .array(shiftRow)
    .parse(data)
    .map((row) => ({ id: row.id, label: formatTime(row.started_at) }));
}
