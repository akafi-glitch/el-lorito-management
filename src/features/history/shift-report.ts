import { z } from "zod";

import type { TicketStatus } from "@/features/tickets/types";

/**
 * Shift Report (owner rules, Nov 2, 2026): what a shift took, to read or print. Only ticket numbers and
 * totals. A sale is a ticket whose customer receipt printed: open and cancelled tickets aren't added in.
 * Open ones are named beside the total, so a manager can see the shift isn't finished.
 */

export const shiftReportRowSchema = z.object({
  ticket_number: z.number().int().positive(),
  status: z.enum(["open", "printed", "cancelled", "finalized"]),
  total_cents: z.number().int().nonnegative(),
});

export type ShiftReportRow = { ticketNumber: number; status: TicketStatus; totalCents: number };
export type ShiftReportLine = { ticketNumber: number; totalCents: number };

export type ShiftReport = {
  lines: ShiftReportLine[];
  totalCents: number;
  openTickets: number[];
  openCents: number;
};

/** Sales in ticket order, and what they add up to. */
export function buildShiftReport(rows: readonly ShiftReportRow[]): ShiftReport {
  const sorted = [...rows].sort((a, b) => a.ticketNumber - b.ticketNumber);
  const lines = sorted
    .filter((row) => row.status === "finalized" || row.status === "printed")
    .map((row) => ({ ticketNumber: row.ticketNumber, totalCents: row.totalCents }));
  const open = sorted.filter((row) => row.status === "open");
  return {
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    openTickets: open.map((row) => row.ticketNumber),
    openCents: open.reduce((sum, row) => sum + row.totalCents, 0),
  };
}

export type ShiftChoice = { id: number; label: string; started: string; ended: string | null };

/** The shift asked for in the link, else the most recent one. Choices come newest first. */
export function chooseShift(choices: readonly ShiftChoice[], asked: string | string[] | undefined): ShiftChoice | null {
  const id = z.coerce.number().int().positive().safeParse(typeof asked === "string" ? asked : undefined);
  return (id.success ? choices.find((choice) => choice.id === id.data) : undefined) ?? choices[0] ?? null;
}

/** "Ticket #1042" or "Tickets #1042, #1043", for the note beside the total. */
export function openTicketsText(numbers: readonly number[]): string {
  const list = numbers.map((number) => `#${number}`).join(", ");
  return `${numbers.length === 1 ? "Ticket" : "Tickets"} ${list}`;
}
