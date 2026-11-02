import { describe, expect, it } from "vitest";

import { historyHref, historyRowSchema, parseHistoryFilters } from "./rules";

describe("order history filters", () => {
  it("default to everything, most recent first", () => {
    expect(parseHistoryFilters({})).toEqual({ shiftId: null, waiterNumber: null, oldestFirst: false, page: 1 });
    expect(historyHref(parseHistoryFilters({}))).toBe("/manage/history");
  });

  it("read the shift, the waiter, the order, and the page from the link", () => {
    const filters = parseHistoryFilters({ shift: "12", waiter: "01", sort: "oldest", page: "3" });
    expect(filters).toEqual({ shiftId: 12, waiterNumber: "01", oldestFirst: true, page: 3 });
    expect(historyHref(filters)).toBe("/manage/history?shift=12&waiter=01&sort=oldest&page=3");
  });

  it("ignore anything that doesn't make sense", () => {
    expect(parseHistoryFilters({ shift: "x", waiter: "a; drop", page: "-1", sort: "sideways" })).toEqual({
      shiftId: null,
      waiterNumber: null,
      oldestFirst: false,
      page: 1,
    });
    expect(parseHistoryFilters({ shift: ["1", "2"] }).shiftId).toBeNull();
  });
});

describe("a history row", () => {
  const row = {
    ticket_id: 1,
    ticket_number: 1042,
    created_at: "2026-11-02T19:35:00Z",
    status: "finalized",
    shift_id: 3,
    shift_started_at: "2026-11-02T15:00:00Z",
    employee_number: "01",
    table_labels: "X2",
    total_cents: 6325,
  };

  it("has the ticket, time, shift, waiter, table, and total: no food items", () => {
    expect(Object.keys(historyRowSchema.parse({ ...row, ticket_lines: [{ item_name: "Taco" }] }))).not.toContain("ticket_lines");
  });

  it("allows a ticket from before any shift", () => {
    expect(historyRowSchema.safeParse({ ...row, shift_id: null, shift_started_at: null }).success).toBe(true);
  });

  it("needs a whole-cent total", () => {
    expect(historyRowSchema.safeParse({ ...row, total_cents: 63.25 }).success).toBe(false);
  });
});
