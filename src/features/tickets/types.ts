import type { Totals } from "@/features/billing/tax";

export type TicketStatus = "open" | "printed" | "cancelled";

export type SavedLine = {
  itemId: number;
  name: string;
  unitCents: number;
  /** Part of the unit price that is the after-3 PM lunch amount (0 otherwise). */
  lateCents: number;
  quantity: number;
  totalCents: number;
  taxGroup: "food" | "liquor";
};

export type StaffRef = { name: string; number: string };

export type SavedTicket = {
  id: number;
  number: number;
  visitId: number;
  status: TicketStatus;
  version: number;
  /** "Tue, Oct 27, 4:02 PM" in the restaurant's time zone. */
  createdAt: string;
  /** "4:02 PM". */
  createdTime: string;
  maker: StaffRef;
  lastEditor: StaffRef | null;
  lines: SavedLine[];
  itemCount: number;
  subtotalCents: number;
  /** Subtotals, taxes, and total, as the database works them out (public.ticket_totals). */
  totals: Totals;
};
