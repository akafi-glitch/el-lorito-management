import { describe, expect, it } from "vitest";

import { RESTAURANT_CLOSED_TEXT } from "@/features/waiter/rules";

import { shouldReload as refusalReloads, ticketErrorMessage as refusalText } from "./errors";

describe("taking food off an order the kitchen has", () => {
  it("says a manager is needed, and reloads the screen, which may be out of date", () => {
    expect(refusalText({ message: "manager_approval_required" })).toMatch(/manager's PIN/);
    expect(refusalReloads({ message: "manager_approval_required" })).toBe(true);
    expect(refusalText({ message: "pin_not_allowed" })).toMatch(/can't approve/);
  });
});

describe("an order sent while the restaurant is closed", () => {
  it("says so, and reloads the screen", () => {
    expect(refusalText({ message: "restaurant_closed" })).toBe(RESTAURANT_CLOSED_TEXT);
    expect(refusalReloads({ message: "restaurant_closed" })).toBe(true);
  });
});

import { computeTotals } from "@/features/billing/tax";
import { addCustomItem, addItem, type Draft } from "@/features/menu/order-draft";

import { shouldReload, ticketErrorMessage } from "./errors";
import { batchesToSend, buildTicket, currentTicket, kitchenMark, kitchenState, orderLinesFromDraft, ticketKitchenMark, withTicket, KITCHEN_MARK_TEXT } from "./rules";
import { cancelTicketSchema, changeTicketSchema, saveOrderSchema, ticketNumberParamSchema, ticketRowSchema, ticketTotalsRowSchema, type TicketRow, type TicketTotalsRow } from "./schema";
import type { SavedBatch, SavedTicket } from "./types";

const line = (id: number, no: number, overrides: Partial<TicketRow["ticket_batches"][number]["ticket_lines"][number]> = {}) => ({
  id,
  line_no: no,
  menu_item_id: id + 100,
  is_custom: false,
  item_name: `Item ${id}`,
  unit_price_cents: 940,
  late_surcharge_cents: 0,
  quantity: 1,
  tax_group_code: "food" as const,
  notes: null,
  ...overrides,
});

const batch = (id: number, no: number, overrides: Partial<TicketRow["ticket_batches"][number]> = {}): TicketRow["ticket_batches"][number] => ({
  id,
  batch_no: no,
  notes: null,
  created_at: "2026-11-02T19:35:00Z",
  kitchen_printed_at: null,
  waiter: { employee_number: "01" },
  print_attempts: [],
  ticket_lines: [line(id * 10, 1)],
  ...overrides,
});

const row: TicketRow = {
  id: 7,
  ticket_number: 1042,
  status: "open",
  version: 2,
  legacy_single_order: false,
  created_at: "2026-11-02T19:35:00Z",
  finalized_at: null,
  maker: { full_name: "Kafi", employee_number: "01" },
  editor: { full_name: "Musfika", employee_number: "02" },
  ticket_batches: [
    batch(2, 2, { waiter: { employee_number: "02" }, notes: "No onions", ticket_lines: [line(20, 1, { quantity: 3, item_name: "Taco", unit_price_cents: 235 })] }),
    batch(1, 1, {
      ticket_lines: [
        line(11, 2, { item_name: "Domestic beer", unit_price_cents: 499, tax_group_code: "liquor" }),
        line(10, 1, { item_name: "Combo #5", quantity: 2 }),
        line(12, 3, { item_name: "Birthday flan", unit_price_cents: 450, menu_item_id: null, is_custom: true }),
      ],
    }),
  ],
};

const totals: TicketTotalsRow = {
  ticket_id: 7,
  food_subtotal_cents: 3035,
  liquor_subtotal_cents: 499,
  food_rate_bp: 850,
  liquor_rate_bp: 1050,
  food_tax_cents: 258,
  liquor_tax_cents: 52,
  total_cents: 3844,
};

const format = { dateTime: (iso: string) => `date ${iso}`, clock: () => "1:35 PM" };
const ticket = buildTicket(row, format, totals);

describe("a saved ticket", () => {
  it("keeps its orders in order, each with its own lines, waiter, and note", () => {
    expect(ticket.batches.map((b) => [b.no, b.waiterNumber, b.notes])).toEqual([
      [1, "01", null],
      [2, "02", "No onions"],
    ]);
    expect(ticket.batches[0]!.lines.map((l) => l.name)).toEqual(["Combo #5", "Domestic beer", "Birthday flan"]);
  });

  it("lists every line of every order, with totals in cents", () => {
    expect(ticket.lines.map((l) => l.totalCents)).toEqual([1880, 499, 450, 705]);
    expect(ticket.itemCount).toBe(7);
    expect(ticket.subtotalCents).toBe(3534);
  });

  it("marks custom items, which have no menu item", () => {
    const flan = ticket.lines.find((l) => l.name === "Birthday flan")!;
    expect(flan.isCustom).toBe(true);
    expect(flan.itemId).toBeNull();
  });

  it("keeps the maker and the last editor apart", () => {
    expect(ticket.maker).toEqual({ name: "Kafi", number: "01" });
    expect(ticket.lastEditor).toEqual({ name: "Musfika", number: "02" });
  });

  it("carries the database's totals, which match the app's own calculation", () => {
    const own = computeTotals(ticket.lines.map((l) => ({ totalCents: l.totalCents, taxGroup: l.taxGroup })), { food: 850, liquor: 1050 });
    expect(ticket.totals).toEqual(own);
  });

  it("refuses totals that belong to another ticket", () => {
    expect(() => buildTicket(row, format, { ...totals, ticket_id: 8 })).toThrow();
  });

  it("reads rows from the database, including null menu items", () => {
    expect(ticketRowSchema.safeParse(row).success).toBe(true);
    expect(ticketTotalsRowSchema.safeParse(totals).success).toBe(true);
    expect(ticketRowSchema.safeParse({ ...row, status: "lost" }).success).toBe(false);
  });
});

describe("which ticket a table's page works on", () => {
  const t = (id: number, status: SavedTicket["status"], isActive = true) => ({ ...ticket, id, status, isActive });

  it("no ticket yet", () => expect(currentTicket([])).toBeNull());

  it("the table's open ticket", () => expect(currentTicket([t(1, "open")])?.id).toBe(1));

  it("none after a finalized ticket: the table is reset for a new order", () => {
    expect(currentTicket([t(1, "cancelled"), t(2, "finalized")])).toBeNull();
  });

  it("not a cancelled ticket: the next order starts a new one", () => {
    expect(currentTicket([t(1, "cancelled")])).toBeNull();
  });

  it("not an old-style ticket from before one group meant one ticket", () => {
    expect(currentTicket([t(1, "open", false), t(2, "printed", false)])).toBeNull();
  });
});

describe("what a table says about its kitchen receipt", () => {
  const withBatches = (...states: SavedBatch["kitchen"][]) => ({
    batches: states.map((kitchen) => ({ kitchen, lines: [{ lineId: 1 }] }) as SavedBatch),
  });

  it("nothing with no ticket, or no order with items", () => {
    expect(ticketKitchenMark(null)).toBeNull();
    expect(ticketKitchenMark({ batches: [] })).toBeNull();
    expect(ticketKitchenMark({ batches: [{ kitchen: "not-sent", lines: [] } as unknown as SavedBatch] })).toBeNull();
    expect(kitchenMark([])).toBeNull();
  });

  it("saved: an order still needs its kitchen receipt", () => {
    expect(ticketKitchenMark(withBatches("not-sent"))).toBe("saved");
    expect(ticketKitchenMark(withBatches("waiting"))).toBe("saved");
    expect(ticketKitchenMark(withBatches("failed"))).toBe("saved");
  });

  it("saved again when a newer order hasn't been printed", () => {
    expect(ticketKitchenMark(withBatches("printed", "not-sent"))).toBe("saved");
  });

  it("printed: every order is with the kitchen, so the customer receipt is next", () => {
    expect(ticketKitchenMark(withBatches("printed"))).toBe("printed");
    expect(ticketKitchenMark(withBatches("printed", "printed"))).toBe("printed");
  });

  it("uses the owner's words", () => {
    expect(KITCHEN_MARK_TEXT).toEqual({ saved: "Kitchen Receipt Saved", printed: "Kitchen Receipt Printed" });
  });
});

describe("a note on one item", () => {
  const order = { employeeNumber: "01", tableCode: "A1", clientKey: crypto.randomUUID(), notes: null };

  it("is sent with its item, trimmed; a blank one is no note", () => {
    const parsed = saveOrderSchema.parse({
      ...order,
      lines: [
        { itemId: 1, quantity: 1, notes: "  No onions " },
        { itemId: 2, quantity: 1, notes: "   " },
        { itemId: 3, quantity: 1 },
      ],
    });
    expect(parsed.lines.map((item) => item.notes)).toEqual(["No onions", null, undefined]);
  });

  it("is refused over 200 characters", () => {
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ itemId: 1, quantity: 1, notes: "x".repeat(201) }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ itemId: 1, quantity: 1, notes: "x".repeat(200) }] }).success).toBe(true);
    expect(
      changeTicketSchema.safeParse({ employeeNumber: "01", ticketId: 1, version: 1, changes: [{ op: "line_notes", lineId: 1, notes: "x".repeat(201) }] }).success,
    ).toBe(false);
  });

  it("goes from the screen to the order", () => {
    expect(orderLinesFromDraft([{ itemId: 12, quantity: 1, note: "Extra rice" }])).toEqual([{ itemId: 12, quantity: 1, notes: "Extra rice" }]);
  });
});

describe("kitchen status of an order", () => {
  it("has not been sent until a print is asked for", () => {
    expect(kitchenState({ kitchen_printed_at: null, print_attempts: [] })).toBe("not-sent");
  });

  it("waits for the waiter's answer: never assumed printed", () => {
    expect(kitchenState({ kitchen_printed_at: null, print_attempts: [{ attempt_no: 1, outcome: "unknown" }] })).toBe("waiting");
  });

  it("failed when the latest answer was No", () => {
    expect(kitchenState({ kitchen_printed_at: null, print_attempts: [{ attempt_no: 1, outcome: "not_printed" }] })).toBe("failed");
  });

  it("printed once a Yes is recorded, whatever happened to other attempts", () => {
    expect(kitchenState({ kitchen_printed_at: "2026-11-02T19:35:00Z", print_attempts: [{ attempt_no: 1, outcome: "not_printed" }] })).toBe("printed");
  });

  it("only new or failed orders with items go to the kitchen", () => {
    const b = (id: number, kitchen: SavedTicket["batches"][number]["kitchen"], lines = ticket.lines) => ({ ...ticket.batches[0]!, id, kitchen, lines });
    const toSend = batchesToSend({ batches: [b(1, "printed"), b(2, "not-sent"), b(3, "failed"), b(4, "waiting"), b(5, "not-sent", [])] });
    expect(toSend.map((x) => x.id)).toEqual([2, 3]);
    expect(batchesToSend(null)).toEqual([]);
  });
});

describe("the order on screen", () => {
  it("is sent as menu items and custom items", () => {
    let draft: Draft = addItem([], 12);
    draft = addCustomItem(draft, { name: "Birthday flan", priceCents: 450, taxCategory: "food" }, 2);
    expect(orderLinesFromDraft(draft)).toEqual([
      { itemId: 12, quantity: 1, notes: null },
      { name: "Birthday flan", priceCents: 450, taxCategory: "food", quantity: 2, notes: null },
    ]);
  });
});

describe("links", () => {
  it("add and remove the ticket number", () => {
    expect(withTicket("/waiter/01/tables/X2", 1001)).toBe("/waiter/01/tables/X2?ticket=1001");
    expect(withTicket("/waiter/01/tables/X2?ticket=1001", null)).toBe("/waiter/01/tables/X2");
  });

  it("read ticket numbers", () => {
    expect(ticketNumberParamSchema.safeParse("1001").success).toBe(true);
    expect(ticketNumberParamSchema.safeParse("12").success).toBe(false);
    expect(ticketNumberParamSchema.safeParse("x").success).toBe(false);
  });
});

describe("what the server accepts", () => {
  const key = "00000000-0000-4000-8000-000000000001";
  const order = { employeeNumber: "01", tableCode: "X2", clientKey: key, notes: null, lines: [{ itemId: 1, quantity: 2 }] };

  it("accepts a menu item, a custom item, and notes", () => {
    expect(saveOrderSchema.safeParse(order).success).toBe(true);
    expect(
      saveOrderSchema.safeParse({ ...order, notes: " No onions ", lines: [{ name: " Flan ", priceCents: 450, taxCategory: "food", quantity: 1 }] }).success,
    ).toBe(true);
    expect(saveOrderSchema.parse({ ...order, notes: " No onions " }).notes).toBe("No onions");
    expect(saveOrderSchema.parse({ ...order, notes: "   " }).notes).toBeNull();
  });

  it("refuses an empty order, repeated items, and quantities outside 1 to 99", () => {
    expect(saveOrderSchema.safeParse({ ...order, lines: [] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ itemId: 1, quantity: 1 }, { itemId: 1, quantity: 2 }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ itemId: 1, quantity: 0 }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ itemId: 1, quantity: 100 }] }).success).toBe(false);
  });

  it("refuses bad custom items: price, name, and above all a missing tax type", () => {
    const custom = { name: "Flan", priceCents: 450, taxCategory: "food", quantity: 1 };
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ ...custom, priceCents: -1 }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ ...custom, priceCents: 1.5 }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ ...custom, name: "  " }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ name: "Flan", priceCents: 450, quantity: 1 }] }).success).toBe(false);
    expect(saveOrderSchema.safeParse({ ...order, lines: [{ ...custom, taxCategory: "tips" }] }).success).toBe(false);
  });

  it("needs a real key, so a repeated save can be recognized", () => {
    expect(saveOrderSchema.safeParse({ ...order, clientKey: "1" }).success).toBe(false);
  });

  it("refuses a very long note", () => {
    expect(saveOrderSchema.safeParse({ ...order, notes: "x".repeat(501) }).success).toBe(false);
  });

  it("changes need the version, and name a line or an order", () => {
    const base = { employeeNumber: "01", ticketId: 1, version: 2 };
    expect(changeTicketSchema.safeParse({ ...base, changes: [{ op: "quantity", lineId: 1, quantity: 3 }] }).success).toBe(true);
    expect(changeTicketSchema.safeParse({ ...base, changes: [{ op: "remove", lineId: 1 }] }).success).toBe(true);
    expect(changeTicketSchema.safeParse({ ...base, changes: [{ op: "notes", batchId: 1, notes: "x" }] }).success).toBe(true);
    expect(changeTicketSchema.safeParse({ ...base, changes: [] }).success).toBe(false);
    expect(changeTicketSchema.safeParse({ ...base, changes: [{ op: "quantity", lineId: 1, quantity: 0 }] }).success).toBe(false);
    expect(changeTicketSchema.safeParse({ employeeNumber: "01", ticketId: 1, changes: [{ op: "remove", lineId: 1 }] }).success).toBe(false);
  });

  it("checks cancel input", () => {
    expect(cancelTicketSchema.safeParse({ employeeNumber: "01", ticketId: 2, version: 3 }).success).toBe(true);
    expect(cancelTicketSchema.safeParse({ employeeNumber: "x", ticketId: 2, version: 3 }).success).toBe(false);
  });
});

describe("messages", () => {
  it("explain refusals in plain words, naming the ticket or item", () => {
    expect(ticketErrorMessage({ message: "ticket_finalized", details: "1042" })).toContain("Ticket #1042 is finalized");
    expect(ticketErrorMessage({ message: "stale_ticket" })).toContain("Someone else just changed this ticket");
    expect(ticketErrorMessage({ message: "item_unavailable", details: "Taco" })).toContain("Taco is turned off");
    expect(ticketErrorMessage({ message: "invalid_custom_item" })).toContain("tax type");
    expect(ticketErrorMessage({ message: "visit_closed" })).toContain("has been cleared");
    expect(ticketErrorMessage({ message: "boom" })).toContain("couldn't be saved");
  });

  it("reload the page only when the screen is out of date", () => {
    expect(shouldReload({ message: "stale_ticket" })).toBe(true);
    expect(shouldReload({ message: "ticket_finalized" })).toBe(true);
    expect(shouldReload({ message: "line_not_found" })).toBe(true);
    expect(shouldReload({ message: "item_unavailable" })).toBe(false);
    expect(shouldReload({ message: "invalid_custom_item" })).toBe(false);
  });
});
