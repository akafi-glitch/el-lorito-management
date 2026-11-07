import { describe, expect, it } from "vitest";

import { printErrorMessage } from "./errors";
import { kitchenItemName, kitchenReceiptFromRow, printableWidthMm, receiptFromSnapshot, RESTAURANT } from "./receipt";
import {
  customerAttemptRowsSchema,
  customerSnapshotSchema,
  kitchenAttemptRowsSchema,
  kitchenBatchRowSchema,
  printCustomerSchema,
  printKitchenSchema,
  printOutcomeSchema,
  type CustomerSnapshot,
  type KitchenBatchRow,
} from "./schema";

const key = "00000000-0000-4000-8000-000000000001";

const snapshot: CustomerSnapshot = {
  ticket_number: 1042,
  waiter_number: "01",
  tables: "X6 + X7 + X8",
  printed_at: "2026-11-02T20:15:00Z",
  lines: [
    { name: "Combo #5", quantity: 2, unit_cents: 940, total_cents: 1880, tax_group: "food" },
    { name: "Domestic beer", quantity: 1, unit_cents: 499, total_cents: 499, tax_group: "liquor" },
  ],
  totals: {
    food_subtotal_cents: 1880,
    liquor_subtotal_cents: 499,
    food_rate_bp: 850,
    liquor_rate_bp: 1050,
    food_tax_cents: 160,
    liquor_tax_cents: 52,
    total_cents: 2591,
  },
};

const kitchenRow: KitchenBatchRow = {
  id: 9,
  batch_no: 2,
  notes: "No onions",
  waiter: { employee_number: "02" },
  ticket: {
    ticket_number: 1042,
    own_table: { label: "X6" },
    visit: { visit_tables: [{ restaurant_tables: { label: "X8" } }, { restaurant_tables: { label: "X6" } }, { restaurant_tables: { label: "X7" } }] },
  },
  ticket_lines: [
    { line_no: 2, item_name: "Beef tacos", quantity: 3, notes: "Extra salsa", menu_item: { name_es: "Tacos de res" } },
    { line_no: 1, item_name: "Chicken fajitas", quantity: 2, notes: null, menu_item: { name_es: "Fajitas de pollo" } },
  ],
};

describe("the customer receipt", () => {
  const receipt = receiptFromSnapshot(snapshot, () => "11/02/2026 2:15 PM");

  it("has everything the owner asked for", () => {
    expect(receipt).toEqual({
      restaurantName: "EL LORITO",
      ticketNumber: 1042,
      tables: "X6 + X7 + X8",
      waiterNumber: "01",
      printedAt: "11/02/2026 2:15 PM",
      lines: [
        { name: "Combo #5", quantity: 2, unitCents: 940, totalCents: 1880 },
        { name: "Domestic beer", quantity: 1, unitCents: 499, totalCents: 499 },
      ],
      totals: {
        foodSubtotalCents: 1880,
        liquorSubtotalCents: 499,
        foodTaxCents: 160,
        liquorTaxCents: 52,
        totalCents: 2591,
        rates: { food: 850, liquor: 1050 },
      },
    });
  });

  it("shows the waiter's number only, never a name", () => {
    expect(JSON.stringify(receipt)).not.toMatch(/Kafi/);
  });

  it("shows what the database stored, not a new calculation", () => {
    const stored = receiptFromSnapshot({ ...snapshot, totals: { ...snapshot.totals, food_tax_cents: 161, total_cents: 2592 } }, String);
    expect(stored.totals.foodTaxCents).toBe(161);
    expect(stored.totals.totalCents).toBe(2592);
  });

  it("only accepts a complete bill from the database", () => {
    expect(customerSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(customerSnapshotSchema.safeParse({ ...snapshot, totals: { ...snapshot.totals, total_cents: null } }).success).toBe(false);
    expect(customerAttemptRowsSchema.safeParse([{ attempt_id: 1, receipt: snapshot, is_copy: false }]).success).toBe(true);
  });

  it("fits the paper: 72 mm of print on 80 mm paper, 48 mm on 58 mm", () => {
    expect(printableWidthMm(80)).toBe(72);
    expect(printableWidthMm(58)).toBe(48);
  });
});

describe("Spanish names on the kitchen receipt", () => {
  it("are the only name, in capitals, with their accents", () => {
    expect(kitchenItemName("Combo #5", "Combinación #5")).toBe("COMBINACIÓN #5");
    expect(kitchenItemName("Jarritos pineapple", "Jarritos de piña")).toBe("JARRITOS DE PIÑA");
    expect(kitchenItemName("Taco", "Taco")).toBe("TACO");
  });

  it("fall back to the item's own name for a custom item, which has none", () => {
    expect(kitchenItemName("Birthday flan", null)).toBe("BIRTHDAY FLAN");
    expect(kitchenItemName("Birthday flan", undefined)).toBe("BIRTHDAY FLAN");
    expect(kitchenItemName("Birthday flan", "  ")).toBe("BIRTHDAY FLAN");
    expect(kitchenReceiptFromRow({ ...kitchenRow, ticket_lines: [{ line_no: 1, item_name: "Birthday flan", quantity: 1, notes: null, menu_item: null }] }, false, "x").lines[0]?.name).toBe("BIRTHDAY FLAN");
  });

  it("are not on the customer's bill: it has only the saved English name", () => {
    expect(JSON.stringify(receiptFromSnapshot(snapshot, () => "x"))).not.toMatch(/combinaci/i);
  });
});

describe("the kitchen receipt", () => {
  const receipt = kitchenReceiptFromRow(kitchenRow, false, "11/02/2026 7:35 PM");

  it("has the ticket, table, waiter, time, this order's items, quantities, and the note", () => {
    expect(receipt).toEqual({
      title: "EL LORITO — KITCHEN",
      ticketNumber: 1042,
      orderNumber: 2,
      tables: "X6 + X7 + X8",
      waiterNumber: "02",
      time: "11/02/2026 7:35 PM",
      isReprint: false,
      lines: [
        { name: "FAJITAS DE POLLO", quantity: 2, note: null },
        { name: "TACOS DE RES", quantity: 3, note: "EXTRA SALSA" },
      ],
      notes: "NO ONIONS",
    });
  });

  it("has no prices, subtotals, taxes, or totals anywhere: the data has no place for them", () => {
    expect(JSON.stringify(receipt)).not.toMatch(/cents|price|total|tax|\$/i);
    expect(Object.keys(receipt.lines[0]!)).toEqual(["name", "quantity", "note"]);
  });

  it("drops the note line when there is no note", () => {
    expect(kitchenReceiptFromRow({ ...kitchenRow, notes: null }, false, "x").notes).toBeNull();
  });

  it("says when it is another copy, so nothing is cooked twice", () => {
    expect(kitchenReceiptFromRow(kitchenRow, true, "x").isReprint).toBe(true);
  });

  it("names the ticket's own table when it has no visit", () => {
    const row = { ...kitchenRow, ticket: { ...kitchenRow.ticket, own_table: { label: "Bar 2" }, visit: null } };
    expect(kitchenReceiptFromRow(row, false, "x").tables).toBe("BAR 2");
  });

  it("reads only what it needs from the database: a price in the row is ignored", () => {
    const parsed = kitchenBatchRowSchema.parse({ ...kitchenRow, ticket_lines: [{ line_no: 1, item_name: "Taco", quantity: 1, notes: null, menu_item: null, unit_price_cents: 235 }] });
    expect(JSON.stringify(parsed)).not.toContain("235");
  });

  it("uses the agreed title", () => {
    expect(RESTAURANT.kitchenTitle).toBe("EL LORITO — KITCHEN");
  });
});

describe("print requests", () => {
  it("each press carries a key, so a repeated press isn't a second print", () => {
    expect(printKitchenSchema.safeParse({ employeeNumber: "01", ticketId: 2, batchIds: null, clientKey: key }).success).toBe(true);
    expect(printKitchenSchema.safeParse({ employeeNumber: "01", ticketId: 2, batchIds: [3], clientKey: key }).success).toBe(true);
    expect(printKitchenSchema.safeParse({ employeeNumber: "01", ticketId: 2, batchIds: [], clientKey: key }).success).toBe(false);
    expect(printKitchenSchema.safeParse({ employeeNumber: "01", ticketId: 2, batchIds: null }).success).toBe(false);
    expect(printCustomerSchema.safeParse({ employeeNumber: "01", ticketId: 2, version: 3, clientKey: key }).success).toBe(true);
    expect(printCustomerSchema.safeParse({ employeeNumber: "01", ticketId: 2, version: null, clientKey: key }).success).toBe(true);
  });

  it("an answer is yes or no, for one or more prints", () => {
    expect(printOutcomeSchema.safeParse({ employeeNumber: "01", attemptIds: [5, 6], printed: false }).success).toBe(true);
    expect(printOutcomeSchema.safeParse({ employeeNumber: "01", attemptIds: [5], printed: "yes" }).success).toBe(false);
    expect(printOutcomeSchema.safeParse({ employeeNumber: "01", attemptIds: [], printed: true }).success).toBe(false);
  });

  it("reads what the database returns", () => {
    expect(kitchenAttemptRowsSchema.safeParse([{ attempt_id: 1, batch_id: 2, attempt_no: 1, is_reprint: false }]).success).toBe(true);
    expect(kitchenAttemptRowsSchema.safeParse([]).success).toBe(false);
  });

  it("explain refusals in plain words", () => {
    expect(printErrorMessage({ message: "nothing_to_print" })).toContain("Nothing new to send");
    expect(printErrorMessage({ message: "stale_ticket" })).toContain("not finalized");
    expect(printErrorMessage({ message: "ticket_finalized", details: "1042" })).toContain("finalized");
    expect(printErrorMessage({ message: "outcome_already_recorded" })).toContain("already saved");
    expect(printErrorMessage({ message: "visit_closed" })).toContain("has been cleared");
    expect(printErrorMessage({ message: "boom" })).toBe("Couldn't reach the server, so nothing was printed. Check the connection and try again.");
  });
});
