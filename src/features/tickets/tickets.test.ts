import { describe, expect, it } from "vitest";

import { shouldReload, ticketErrorMessage } from "./errors";
import { buildTicket, canEdit, draftFromTicket, hasUnsavedChanges, savedPriceMap, staffLabel, withTicket } from "./rules";
import { computeTotals } from "@/features/billing/tax";

import { cancelTicketSchema, saveTicketSchema, ticketNumberParamSchema, type TicketRow, type TicketTotalsRow } from "./schema";

const row: TicketRow = {
  id: 7,
  ticket_number: 1001,
  visit_id: 3,
  status: "open",
  version: 2,
  created_at: "2026-10-27T21:05:00Z",
  maker: { full_name: "Kafi", employee_number: "01" },
  editor: { full_name: "Musfika", employee_number: "02" },
  ticket_lines: [
    // Out of order on purpose: line_no decides.
    { line_no: 2, menu_item_id: 50, item_name: "Domestic beer", unit_price_cents: 499, late_surcharge_cents: 0, quantity: 1, tax_group_code: "liquor" },
    { line_no: 1, menu_item_id: 10, item_name: "Combo #5", unit_price_cents: 940, late_surcharge_cents: 0, quantity: 2, tax_group_code: "food" },
    { line_no: 3, menu_item_id: 2, item_name: "Lunch #2", unit_price_cents: 899, late_surcharge_cents: 100, quantity: 1, tax_group_code: "food" },
  ],
};
const totalsRow: TicketTotalsRow = {
  ticket_id: 7,
  food_subtotal_cents: 2779,
  liquor_subtotal_cents: 499,
  food_rate_bp: 850,
  liquor_rate_bp: 1050,
  food_tax_cents: 236,
  liquor_tax_cents: 52,
  total_cents: 3566,
};
const ticket = buildTicket(row, { dateTime: () => "Tue, Oct 27, 4:05 PM", clock: () => "4:05 PM" }, totalsRow);

describe("a saved ticket", () => {
  it("lists lines in the order they were added, with totals in cents", () => {
    expect(ticket.lines.map((l) => [l.name, l.quantity, l.totalCents])).toEqual([
      ["Combo #5", 2, 1880],
      ["Domestic beer", 1, 499],
      ["Lunch #2", 1, 899],
    ]);
    expect(ticket.itemCount).toBe(4);
    expect(ticket.subtotalCents).toBe(3278);
  });

  it("keeps the maker and the last editor apart", () => {
    expect(staffLabel(ticket.maker)).toBe("Kafi (01)");
    expect(ticket.lastEditor && staffLabel(ticket.lastEditor)).toBe("Musfika (02)");
    expect(buildTicket({ ...row, editor: null }, { dateTime: String, clock: String }, totalsRow).lastEditor).toBeNull();
  });

  it("remembers the after-3 PM part of a lunch price", () => {
    expect(ticket.lines[2]).toMatchObject({ unitCents: 899, lateCents: 100, taxGroup: "food" });
  });

  it("carries the database's totals, which match the app's own calculation", () => {
    expect(ticket.totals).toEqual({
      foodSubtotalCents: 2779,
      liquorSubtotalCents: 499,
      foodTaxCents: 236,
      liquorTaxCents: 52,
      totalCents: 3566,
      rates: { food: 850, liquor: 1050 },
    });
    expect(computeTotals(ticket.lines, { food: 850, liquor: 1050 })).toEqual(ticket.totals);
  });

  it("refuses totals that belong to another ticket", () => {
    expect(() => buildTicket(row, { dateTime: String, clock: String }, { ...totalsRow, ticket_id: 8 })).toThrow();
  });

  it("shows saved names and prices in the order panel", () => {
    expect(savedPriceMap(ticket).get(10)).toEqual({ name: "Combo #5", unitCents: 940, taxGroup: "food" });
    expect(savedPriceMap(null).size).toBe(0);
  });
});

describe("editing", () => {
  it("starts from the saved lines (or empty for a new ticket)", () => {
    expect(draftFromTicket(ticket)).toEqual([
      { itemId: 10, quantity: 2 },
      { itemId: 50, quantity: 1 },
      { itemId: 2, quantity: 1 },
    ]);
    expect(draftFromTicket(null)).toEqual([]);
  });

  it("notices changed quantities, added or removed items, and reordering", () => {
    const saved = draftFromTicket(ticket);
    expect(hasUnsavedChanges(saved, saved)).toBe(false);
    expect(hasUnsavedChanges([{ itemId: 10, quantity: 3 }, ...saved.slice(1)], saved)).toBe(true);
    expect(hasUnsavedChanges(saved.slice(0, 2), saved)).toBe(true);
    expect(hasUnsavedChanges([...saved, { itemId: 99, quantity: 1 }], saved)).toBe(true);
    expect(hasUnsavedChanges([saved[1]!, saved[0]!, saved[2]!], saved)).toBe(true);
  });

  it("only open tickets on an open table can change", () => {
    expect(canEdit(null, true)).toBe(true);
    expect(canEdit({ status: "open" }, true)).toBe(true);
    expect(canEdit({ status: "printed" }, true)).toBe(false);
    expect(canEdit({ status: "cancelled" }, true)).toBe(false);
    expect(canEdit({ status: "open" }, false)).toBe(false);
  });
});

describe("links", () => {
  it("adds and removes the ticket number, keeping the other-section confirmation", () => {
    expect(withTicket("/waiter/01/tables/X2", 1001)).toBe("/waiter/01/tables/X2?ticket=1001");
    expect(withTicket("/waiter/01/tables/B3?continue=1", 1002)).toBe("/waiter/01/tables/B3?continue=1&ticket=1002");
    expect(withTicket("/waiter/01/tables/B3?continue=1&ticket=1002", null)).toBe("/waiter/01/tables/B3?continue=1");
    expect(withTicket("/waiter/01/tables/X2?ticket=1001", null)).toBe("/waiter/01/tables/X2");
  });

  it("reads ticket numbers from links", () => {
    expect(ticketNumberParamSchema.safeParse("1001").data).toBe(1001);
    expect(ticketNumberParamSchema.safeParse("1000").success).toBe(false);
    expect(ticketNumberParamSchema.safeParse("abc").success).toBe(false);
  });
});

describe("what the server accepts", () => {
  const base = { employeeNumber: "01", visitId: 3, ticketId: null, version: null, lines: [{ itemId: 10, quantity: 2 }] };

  it("accepts a new ticket and a change to a saved one", () => {
    expect(saveTicketSchema.safeParse(base).success).toBe(true);
    expect(saveTicketSchema.safeParse({ ...base, ticketId: 7, version: 2 }).success).toBe(true);
  });

  it("refuses an empty order, repeated items, and quantities outside 1 to 99", () => {
    expect(saveTicketSchema.safeParse({ ...base, lines: [] }).error?.issues[0]?.message).toBe("Add at least one item before saving.");
    expect(saveTicketSchema.safeParse({ ...base, lines: [{ itemId: 10, quantity: 1 }, { itemId: 10, quantity: 1 }] }).success).toBe(false);
    expect(saveTicketSchema.safeParse({ ...base, lines: [{ itemId: 10, quantity: 0 }] }).success).toBe(false);
    expect(saveTicketSchema.safeParse({ ...base, lines: [{ itemId: 10, quantity: 100 }] }).success).toBe(false);
    expect(saveTicketSchema.safeParse({ ...base, lines: [{ itemId: 10, quantity: 1.5 }] }).success).toBe(false);
  });

  it("needs the version whenever it changes a saved ticket", () => {
    expect(saveTicketSchema.safeParse({ ...base, ticketId: 7, version: null }).success).toBe(false);
    expect(saveTicketSchema.safeParse({ ...base, ticketId: null, version: 2 }).success).toBe(false);
  });

  it("checks the employee number and cancel input", () => {
    expect(saveTicketSchema.safeParse({ ...base, employeeNumber: "x1" }).success).toBe(false);
    expect(cancelTicketSchema.safeParse({ employeeNumber: "01", visitId: 3, ticketId: 7, version: 2 }).success).toBe(true);
    expect(cancelTicketSchema.safeParse({ employeeNumber: "01", visitId: 3, ticketId: 7 }).success).toBe(false);
  });
});

describe("messages", () => {
  it("explains refusals in plain words, naming the ticket or item", () => {
    expect(ticketErrorMessage({ message: "stale_ticket" })).toContain("Someone else just changed this ticket");
    expect(ticketErrorMessage({ message: "ticket_printed", details: "1001" })).toBe(
      "Ticket #1001 is printed, so it can't be changed. Start a new ticket instead.",
    );
    expect(ticketErrorMessage({ message: "ticket_cancelled" })).toBe("This ticket was cancelled. Start a new ticket instead.");
    expect(ticketErrorMessage({ message: "item_unavailable", details: "Taco" })).toBe("Taco is turned off right now. Remove it and save again.");
    expect(ticketErrorMessage({ message: "visit_closed" })).toContain("has been cleared");
    expect(ticketErrorMessage({ message: "boom" })).toContain("couldn't be saved");
  });

  it("reloads the page only when the screen is out of date", () => {
    expect(shouldReload({ message: "stale_ticket" })).toBe(true);
    expect(shouldReload({ message: "visit_closed" })).toBe(true);
    expect(shouldReload({ message: "item_unavailable" })).toBe(false);
    expect(shouldReload({ message: "empty_ticket" })).toBe(false);
  });
});
