import { describe, expect, it } from "vitest";

import { visitsByTable } from "@/features/floor/visits";

import { seatingErrorMessage, shouldRefresh } from "./errors";
import { seatPartySchema, sectionOpenSchema, visitChangeSchema } from "./schema";

describe("seating input checks", () => {
  it("accepts one table or several", () => {
    expect(seatPartySchema.parse({ tableCodes: ["A3"], guestCount: 3 }).combinationCode).toBeNull();
    expect(seatPartySchema.safeParse({ tableCodes: ["X6", "X7", "X8"], guestCount: 14, combinationCode: "X6+X7+X8" }).success).toBe(true);
  });

  it.each([
    [{ tableCodes: [], guestCount: 2 }, "Choose at least one table."],
    [{ tableCodes: ["A3", "A3"], guestCount: 2 }, "A table was chosen twice."],
    [{ tableCodes: ["A3"], guestCount: 0 }, "Enter a number of guests from 1 to 100."],
    [{ tableCodes: ["A3"], guestCount: 101 }, "Enter a number of guests from 1 to 100."],
    [{ tableCodes: ["A3"], guestCount: 2.5 }, "Enter a whole number of guests."],
    [{ tableCodes: ["a3; drop table"], guestCount: 2 }, "Unknown table."],
  ])("refuses %j", (input, message) => {
    const result = seatPartySchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("needs a positive visit id and version", () => {
    expect(visitChangeSchema.safeParse({ visitId: 3, version: 1 }).success).toBe(true);
    expect(visitChangeSchema.safeParse({ visitId: 3, version: 0 }).success).toBe(false);
  });

  it("only accepts real-looking section codes", () => {
    expect(sectionOpenSchema.safeParse({ sectionCode: "X-1", isOpen: false }).success).toBe(true);
    expect(sectionOpenSchema.safeParse({ sectionCode: "x-1'", isOpen: false }).success).toBe(false);
  });
});

describe("database refusals in plain words", () => {
  it("names the taken table and asks for a refresh", () => {
    const error = { message: "table_occupied", details: "A3" };
    expect(seatingErrorMessage(error)).toBe("A3 was just taken on another device. The floor has been refreshed.");
    expect(shouldRefresh(error)).toBe(true);
  });

  it("treats the database's own double-seat guard the same way", () => {
    expect(seatingErrorMessage({ code: "23505" })).toMatch(/just taken/);
    expect(shouldRefresh({ code: "23505" })).toBe(true);
  });

  it("tells the host to open a closed section first", () => {
    expect(seatingErrorMessage({ message: "section_closed", details: "B" })).toBe(
      "Section B is closed. Open the section first, then seat the guests.",
    );
    expect(seatingErrorMessage({ message: "section_closed" })).toMatch(/^That section is closed/);
  });

  it("explains out-of-date screens and the chips order", () => {
    expect(seatingErrorMessage({ message: "stale_visit" })).toMatch(/changed on another device/);
    expect(seatingErrorMessage({ message: "chips_not_served" })).toBe("Mark chips served before clearing the table.");
  });

  it("never shows raw database text", () => {
    expect(seatingErrorMessage({ message: 'relation "x" does not exist' })).toBe(
      "The change couldn't be saved. Check the connection and try again.",
    );
    expect(shouldRefresh({ message: "something else" })).toBe(false);
  });
});

describe("grouping seated tables by party", () => {
  const table = (id: string, label: string) => ({
    id, code: label, label, section_code: "A", capacity: 4, area_code: "A",
    layout_row: 1, layout_col: 1, sort_order: 1, is_active: true,
  });
  const visit = { id: 5, version: 2, guest_count: 9, chips_status: "served" as const, cleared_at: null };

  it("gives every table of a combined party the full table list", () => {
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"] as const;
    const map = visitsByTable(
      [
        { table_id: ids[1], visit_id: 5, customer_visits: visit },
        { table_id: ids[0], visit_id: 5, customer_visits: visit },
      ],
      [table(ids[0], "A3"), table(ids[1], "A4")],
    );
    expect(map.get(ids[0])).toEqual({ visitId: 5, version: 2, guestCount: 9, chipsServed: true, tableLabels: ["A3", "A4"] });
    expect(map.get(ids[1])?.tableLabels).toEqual(["A3", "A4"]);
  });
});
