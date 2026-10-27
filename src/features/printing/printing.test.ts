import { describe, expect, it } from "vitest";

import { printErrorMessage } from "./errors";
import { buildReceipt, printableWidthMm, receiptFromRow, RESTAURANT } from "./receipt";
import { printOutcomeSchema, printTicketSchema, receiptRowSchema, reprintTicketSchema, type ReceiptRow } from "./schema";

const row: ReceiptRow = {
  ticket_number: 1001,
  status: "printed",
  printed_at: "2026-10-27T21:05:00Z",
  food_subtotal_cents: 1880,
  liquor_subtotal_cents: 499,
  food_rate_bp: 850,
  liquor_rate_bp: 1050,
  food_tax_cents: 160,
  liquor_tax_cents: 52,
  total_cents: 2591,
  maker: { employee_number: "01" },
  ticket_lines: [
    { line_no: 2, item_name: "Domestic beer", quantity: 1, unit_price_cents: 499 },
    { line_no: 1, item_name: "Combo #5", quantity: 2, unit_price_cents: 940 },
  ],
  visit: {
    visit_tables: [
      { restaurant_tables: { label: "X8", sort_order: 43 } },
      { restaurant_tables: { label: "X6", sort_order: 41 } },
      { restaurant_tables: { label: "X7", sort_order: 42 } },
    ],
  },
};

describe("the printed ticket", () => {
  const receipt = receiptFromRow(row, () => "10/27/2026 4:05 PM");

  it("has everything the owner asked for", () => {
    expect(receipt).toEqual({
      restaurantName: "EL LORITO",
      restaurantSubtitle: "Mexican Restaurant",
      ticketNumber: 1001,
      tables: "X6 + X7 + X8",
      waiterNumber: "01",
      printedAt: "10/27/2026 4:05 PM",
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

  it("shows the waiter's number only (owner decision), never a name", () => {
    expect(JSON.stringify(receipt)).not.toMatch(/Kafi/);
    expect(receipt.waiterNumber).toBe("01");
  });

  it("uses the frozen totals from the database, not a new calculation", () => {
    const changed = receiptFromRow({ ...row, food_tax_cents: 161, total_cents: 2592 }, String);
    expect(changed.totals.foodTaxCents).toBe(161);
    expect(changed.totals.totalCents).toBe(2592);
  });

  it("names a single table plainly", () => {
    expect(buildReceipt({ ticketNumber: 1002, tableLabels: ["Bar 1"], waiterNumber: "7", printedAt: "x", lines: [], totals: receipt.totals }).tables).toBe(
      "Bar 1",
    );
    expect(RESTAURANT).toEqual({ name: "EL LORITO", subtitle: "Mexican Restaurant" });
  });

  it("only accepts printed tickets from the database", () => {
    expect(receiptRowSchema.safeParse(row).success).toBe(true);
    expect(receiptRowSchema.safeParse({ ...row, status: "open" }).success).toBe(false);
    expect(receiptRowSchema.safeParse({ ...row, total_cents: null }).success).toBe(false);
  });

  it("fits the paper: 72 mm of print on 80 mm paper, 48 mm on 58 mm", () => {
    expect(printableWidthMm(80)).toBe(72);
    expect(printableWidthMm(58)).toBe(48);
  });
});

describe("print requests", () => {
  it("need a saved ticket at its version, the waiter's number, and a yes/no answer", () => {
    expect(printTicketSchema.safeParse({ employeeNumber: "01", visitId: 1, ticketId: 2, version: 3 }).success).toBe(true);
    expect(printTicketSchema.safeParse({ employeeNumber: "01", visitId: 1, ticketId: 2 }).success).toBe(false);
    expect(reprintTicketSchema.safeParse({ employeeNumber: "01", ticketId: 2 }).success).toBe(true);
    expect(printOutcomeSchema.safeParse({ employeeNumber: "01", attemptId: 5, printed: false }).success).toBe(true);
    expect(printOutcomeSchema.safeParse({ employeeNumber: "01", attemptId: 5, printed: "yes" }).success).toBe(false);
  });

  it("explain refusals in plain words", () => {
    expect(printErrorMessage({ message: "ticket_printed" })).toContain("Print again");
    expect(printErrorMessage({ message: "ticket_not_printed" })).toContain("hasn't been printed yet");
    expect(printErrorMessage({ message: "outcome_already_recorded" })).toContain("already saved");
    expect(printErrorMessage({ message: "stale_ticket" })).toContain("Someone else just changed this ticket");
    expect(printErrorMessage({ message: "visit_closed" })).toContain("has been cleared");
    expect(printErrorMessage({ message: "boom" })).toBe("Couldn't reach the server, so nothing was printed. Check the connection and try again.");
  });
});
