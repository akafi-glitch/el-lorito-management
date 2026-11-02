import { z } from "zod";

import type { TicketStatus } from "@/features/tickets/types";

/** Order History (owner rules, Nov 2, 2026): one row per ticket, newest first, saved totals only. */

export const HISTORY_PAGE_SIZE = 50;

export const historyRowSchema = z.object({
  ticket_id: z.number().int().positive(),
  ticket_number: z.number().int().positive(),
  created_at: z.string(),
  status: z.enum(["open", "printed", "cancelled", "finalized"]),
  shift_id: z.number().int().positive().nullable(),
  shift_started_at: z.string().nullable(),
  employee_number: z.string(),
  table_labels: z.string().nullable(),
  total_cents: z.number().int().nonnegative(),
});

export type HistoryRow = {
  ticketNumber: number;
  time: string;
  shift: string;
  waiterNumber: string;
  tables: string;
  totalCents: number;
  status: TicketStatus;
};

export type HistoryFilters = { shiftId: number | null; waiterNumber: string | null; oldestFirst: boolean; page: number };

const param = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/** Reads the page's link. Anything that doesn't make sense is ignored. */
export function parseHistoryFilters(query: Record<string, string | string[] | undefined>): HistoryFilters {
  const shift = z.coerce.number().int().positive().safeParse(param(query.shift));
  const waiter = z.string().regex(/^[0-9]{1,6}$/).safeParse(param(query.waiter));
  const page = z.coerce.number().int().min(1).max(100_000).safeParse(param(query.page));
  return {
    shiftId: shift.success ? shift.data : null,
    waiterNumber: waiter.success ? waiter.data : null,
    oldestFirst: param(query.sort) === "oldest",
    page: page.success ? page.data : 1,
  };
}

/** The link for these filters; only what differs from the defaults goes in it. */
export function historyHref(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.shiftId !== null) params.set("shift", String(filters.shiftId));
  if (filters.waiterNumber !== null) params.set("waiter", filters.waiterNumber);
  if (filters.oldestFirst) params.set("sort", "oldest");
  if (filters.page > 1) params.set("page", String(filters.page));
  const text = params.toString();
  return text ? `/manage/history?${text}` : "/manage/history";
}

export const HISTORY_STATUS_TEXT: Record<TicketStatus, string> = {
  open: "Open",
  printed: "Printed",
  finalized: "Finalized",
  cancelled: "Cancelled",
};
