import { describe, expect, it } from "vitest";

import { historyHref, historyRowSchema, parseHistoryFilters } from "./rules";
import { buildShiftReport, chooseShift, openTicketsText, type ShiftChoice } from "./shift-report";

describe("shift report", () => {
  const rows = [
    { ticketNumber: 1003, status: "finalized", totalCents: 500 },
    { ticketNumber: 1001, status: "printed", totalCents: 1705 },
    { ticketNumber: 1004, status: "cancelled", totalCents: 999 },
    { ticketNumber: 1002, status: "open", totalCents: 250 },
    { ticketNumber: 1005, status: "open", totalCents: 100 },
  ] as const;

  it("lists sold tickets in order, and adds up only those", () => {
    const report = buildShiftReport(rows);
    expect(report.lines).toEqual([
      { ticketNumber: 1001, totalCents: 1705 },
      { ticketNumber: 1003, totalCents: 500 },
    ]);
    expect(report.totalCents).toBe(2205);
  });

  it("names open tickets apart, and leaves cancelled ones out", () => {
    const report = buildShiftReport(rows);
    expect(report.openTickets).toEqual([1002, 1005]);
    expect(report.openCents).toBe(350);
    expect(openTicketsText(report.openTickets)).toBe("Tickets #1002, #1005");
    expect(openTicketsText([1002])).toBe("Ticket #1002");
  });

  it("is empty, not broken, with nothing sold", () => {
    expect(buildShiftReport([])).toEqual({ lines: [], totalCents: 0, openTickets: [], openCents: 0 });
  });

  const shifts: ShiftChoice[] = [
    { id: 9, label: "new", started: "x", ended: null },
    { id: 8, label: "old", started: "x", ended: "y" },
  ];

  it("opens on the most recent shift, or the one in the link", () => {
    expect(chooseShift(shifts, undefined)?.id).toBe(9);
    expect(chooseShift(shifts, "8")?.id).toBe(8);
  });

  it("ignores a link that makes no sense", () => {
    expect(chooseShift(shifts, "x")?.id).toBe(9);
    expect(chooseShift(shifts, "77")?.id).toBe(9);
    expect(chooseShift(shifts, ["8", "9"])?.id).toBe(9);
    expect(chooseShift([], "8")).toBeNull();
  });
});

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
