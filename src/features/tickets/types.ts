import type { Totals } from "@/features/billing/tax";

export type TicketStatus = "open" | "printed" | "cancelled" | "finalized";

export type SavedLine = {
  lineId: number;
  /** The menu item; null for a custom item. */
  itemId: number | null;
  isCustom: boolean;
  name: string;
  unitCents: number;
  /** Part of the unit price that is the after-3 PM lunch amount (0 otherwise). */
  lateCents: number;
  quantity: number;
  totalCents: number;
  taxGroup: "food" | "liquor";
  /** A note for the kitchen about this item only. */
  notes: string | null;
};

/** Where an order stands with the kitchen. Only a waiter's "Yes, it printed" makes it "printed". */
export type KitchenState = "not-sent" | "waiting" | "failed" | "printed";

export type SavedBatch = {
  id: number;
  no: number;
  notes: string | null;
  waiterNumber: string;
  /** "4:02 PM". */
  time: string;
  kitchen: KitchenState;
  lines: SavedLine[];
};

export type StaffRef = { name: string; number: string };

export type SavedTicket = {
  id: number;
  number: number;
  status: TicketStatus;
  version: number;
  /** True for the table's one current ticket; old-style tickets are kept apart. */
  isActive: boolean;
  /** "Tue, Oct 27, 4:02 PM" in the restaurant's time zone. */
  createdAt: string;
  /** "4:02 PM". */
  createdTime: string;
  maker: StaffRef;
  lastEditor: StaffRef | null;
  batches: SavedBatch[];
  /** Every line of every order. */
  lines: SavedLine[];
  itemCount: number;
  subtotalCents: number;
  /** Subtotals, taxes, and total, as the database works them out (public.ticket_totals). */
  totals: Totals;
};
