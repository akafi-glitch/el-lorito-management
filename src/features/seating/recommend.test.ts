import { describe, expect, it } from "vitest";
import { z } from "zod";

import { allTables, buildFloorMap, type FloorMap } from "@/features/floor/layout";
import { combinationRowSchema, floorAreaRowSchema, sectionRowSchema, tableRowSchema, type FloorRows } from "@/features/floor/schema";
import type { VisitSnapshot } from "@/features/floor/status";

import fixture from "../../../tests/fixtures/floor-rows.json";

import { GuestCountError, recommendSeating, rotationFrom } from "./recommend";

/** The real layout, with some tables seated and some sections closed. */
function floor(options: { seated?: string[]; closed?: string[]; next?: string; capacities?: Record<string, number> } = {}): FloorMap {
  const rows: FloorRows = {
    areas: z.array(floorAreaRowSchema).parse(fixture.areas),
    sections: z.array(sectionRowSchema).parse(fixture.sections).map((section) => ({
      ...section,
      is_open: !(options.closed ?? []).includes(section.code),
    })),
    tables: z.array(tableRowSchema).parse(fixture.tables).map((table) => ({
      ...table,
      capacity: options.capacities?.[table.code] ?? table.capacity,
    })),
    combinations: z.array(combinationRowSchema).parse(fixture.combinations),
  };
  const visits = new Map<string, VisitSnapshot>();
  for (const [index, code] of (options.seated ?? []).entries()) {
    const table = rows.tables.find((row) => row.code === code);
    if (!table) throw new Error(`no table ${code}`);
    visits.set(table.id, { visitId: index + 1, version: 1, guestCount: 2, chipsServed: false, tableLabels: [code] });
  }
  return buildFloorMap(rows, { visits, nextSectionCode: options.next ?? "A" });
}

function suggest(guestCount: number, map: FloorMap) {
  return recommendSeating({
    guestCount,
    tables: allTables(map),
    sections: map.sections,
    combinations: map.combinations,
    nextSectionCode: map.nextSectionCode,
  });
}

const labels = (guestCount: number, map: FloorMap) => suggest(guestCount, map).options.map((o) => o.label);

describe("section rotation", () => {
  it("follows A, C, B, X(1), X(2), P from the next section", () => {
    expect(rotationFrom(floor().sections, "B").map((s) => s.name)).toEqual(["B", "X(1)", "X(2)", "P", "A", "C"]);
  });

  it("skips closed sections", () => {
    expect(rotationFrom(floor({ closed: ["C"] }).sections, "A").map((s) => s.name)).toEqual(["A", "B", "X(1)", "X(2)", "P"]);
  });

  it("never includes Party or Bar", () => {
    const names = rotationFrom(floor().sections, "A").map((s) => s.name);
    expect(names).not.toContain("Party");
    expect(names).not.toContain("Bar");
  });

  it("first suggestion is in the next section, then one per following section", () => {
    expect(suggest(3, floor({ next: "C" })).options.map((o) => o.where)).toEqual(["Section C", "Section B", "Section X(1)"]);
  });
});

describe("table size matching (6 or fewer guests)", () => {
  it("gives 4 guests a 4-chair table before a 6-chair one", () => {
    // Section A: A1, A2, A3, A5, A6 have 4 chairs, A4 has 6. Smallest that fits, then table order.
    expect(labels(4, floor())[0]).toBe("A1");
  });

  it("gives 5 or 6 guests a 6-chair table", () => {
    expect(labels(5, floor())).toEqual(["A4", "C1", "B4"]);
    expect(labels(6, floor())).toEqual(["A4", "C1", "B4"]);
  });

  it("gives 2 guests a 2-chair table when X(2) is next", () => {
    expect(labels(2, floor({ next: "X-2" }))[0]).toBe("X13");
  });

  it("never suggests an occupied table", () => {
    expect(labels(5, floor({ seated: ["A4"] }))).toEqual(["C1", "B4", "X10"]);
  });

  it("never suggests a table in a closed section", () => {
    expect(labels(5, floor({ closed: ["A", "C"] }))[0]).toBe("B4");
  });

  it("never suggests the Bar", () => {
    const options = suggest(1, floor()).options;
    expect(options.some((o) => o.tableCodes.some((code) => code.startsWith("BAR")))).toBe(false);
  });

  it("explains when nothing fits", () => {
    const closedAll = floor({ closed: ["A", "B", "C", "X-1", "X-2", "P"] });
    const advice = suggest(2, closedAll);
    expect(advice.options).toEqual([]);
    expect(advice.message).toMatch(/No open table fits 2 guests/);
  });
});

describe("large parties (7 or more)", () => {
  it("suggests Party areas first, with a reminder because their seats aren't set", () => {
    const advice = suggest(9, floor());
    expect(advice.options.map((o) => o.label)).toEqual(["Party 1", "Party 2", "Party 3"]);
    expect(advice.options[0]?.note).toMatch(/check Party 1 fits 9/);
  });

  it("moves to approved combinations when the Party areas are full", () => {
    const advice = suggest(9, floor({ seated: ["PARTY-1", "PARTY-2", "PARTY-3"] }));
    expect(advice.options.map((o) => o.label)).toEqual(["A3 + A4", "B3 + B4", "C3 + C4"]);
    expect(advice.options[0]).toMatchObject({ kind: "combination", combinationCode: "A3+A4", capacity: 10 });
  });

  it("picks the smallest combination that fits", () => {
    const options = suggest(11, floor({ seated: ["PARTY-1", "PARTY-2", "PARTY-3"] })).options;
    expect(options.map((o) => [o.label, o.capacity])).toEqual([
      ["A4 + B4", 12],
      ["X6 + X7 + X8", 18],
    ]);
  });

  it("allows only X6 + X7 + X8 above twelve guests", () => {
    const options = suggest(13, floor({ seated: ["PARTY-1", "PARTY-2", "PARTY-3"] })).options;
    expect(options.map((o) => o.label)).toEqual(["X6 + X7 + X8"]);
  });

  it("skips a combination if any of its tables is taken", () => {
    const options = suggest(9, floor({ seated: ["PARTY-1", "PARTY-2", "PARTY-3", "A4"] })).options;
    expect(options.map((o) => o.label)).toEqual(["B3 + B4", "C3 + C4", "X6 + X7 + X8"]);
  });

  it("skips a Party area too small once its seats are set", () => {
    const options = suggest(9, floor({ capacities: { "PARTY-1": 8 } })).options;
    expect(options.map((o) => o.label)).toEqual(["Party 2", "Party 3", "A3 + A4"]);
  });

  it("explains when nothing is free", () => {
    const advice = suggest(14, floor({ seated: ["PARTY-1", "PARTY-2", "PARTY-3", "X7"] }));
    expect(advice.options).toEqual([]);
    expect(advice.message).toMatch(/Join tables by hand/);
  });

  it("labels a combination across two sections", () => {
    const options = suggest(11, floor({ seated: ["PARTY-1", "PARTY-2", "PARTY-3"] })).options;
    expect(options[0]?.where).toBe("Sections A and B");
  });
});

describe("guest count", () => {
  it.each([0, -1, 2.5, 101, Number.NaN])("refuses %s guests", (guests) => {
    expect(() => suggest(guests, floor())).toThrow(GuestCountError);
  });
});
