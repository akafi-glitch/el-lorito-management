import "server-only";

import { z } from "zod";

import { formatTime } from "@/features/staff/queries";
import { createAdminClient } from "@/lib/supabase/admin";

import { HISTORY_PAGE_SIZE, historyRowSchema, type HistoryFilters, type HistoryRow } from "./rules";
import { buildShiftReport, shiftReportRowSchema, type ShiftChoice, type ShiftReport } from "./shift-report";

export type HistoryPage = { rows: HistoryRow[]; hasMore: boolean };
export type ShiftOption = { id: number; label: string };

const shiftRow = z.object({ id: z.number().int().positive(), started_at: z.string() });
const shiftChoiceRow = shiftRow.extend({ ended_at: z.string().nullable() });
const REPORT_BATCH = 1000; // the most rows one database request returns

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

/** The most recent shifts, newest first, for the Shift Report. */
export async function loadShiftChoices(): Promise<ShiftChoice[]> {
  const { data, error } = await createAdminClient().from("shifts").select("id, started_at, ended_at").order("started_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not load the shifts: ${error.message}`);
  return z
    .array(shiftChoiceRow)
    .parse(data)
    .map((row) => {
      const started = formatTime(row.started_at);
      const ended = row.ended_at ? formatTime(row.ended_at) : null;
      return { id: row.id, started, ended, label: ended ? `${started} to ${ended}` : `${started} (open now)` };
    });
}

/** One shift's sales. Every ticket is read, however many there are: the total must never be short. */
export async function loadShiftReport(shiftId: number): Promise<ShiftReport> {
  const db = createAdminClient();
  const rows: z.infer<typeof shiftReportRowSchema>[] = [];
  for (let from = 0; ; from += REPORT_BATCH) {
    const { data, error } = await db
      .from("ticket_history")
      .select("ticket_number, status, total_cents")
      .eq("shift_id", shiftId)
      .order("ticket_number")
      .range(from, from + REPORT_BATCH - 1);
    if (error) throw new Error(`Could not load the shift report: ${error.message}`);
    const page = z.array(shiftReportRowSchema).parse(data);
    rows.push(...page);
    if (page.length < REPORT_BATCH) break;
  }
  return buildShiftReport(rows.map((row) => ({ ticketNumber: row.ticket_number, status: row.status, totalCents: row.total_cents })));
}
