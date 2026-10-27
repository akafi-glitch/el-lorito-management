import { describe, expect, it } from "vitest";
import { z } from "zod";

import fixture from "../../../tests/fixtures/floor-rows.json";

import { buildFloorMap, combinedCapacity, FloorLayoutError, naturalCompare } from "./layout";
import { combinationRowSchema, floorAreaRowSchema, sectionRowSchema, tableRowSchema, type FloorRows } from "./schema";
import { deriveTableStatus } from "./status";

/** The real layout rows, exported from a database after running the migrations. */
function realRows(): FloorRows {
  return {
    areas: z.array(floorAreaRowSchema).parse(fixture.areas),
    sections: z.array(sectionRowSchema).parse(fixture.sections),
    tables: z.array(tableRowSchema).parse(fixture.tables),
    combinations: z.array(combinationRowSchema).parse(fixture.combinations),
  };
}

const codesIn = (areaCode: string) => {
  const map = buildFloorMap(realRows());
  return map.areas.find((area) => area.code === areaCode)?.tables.map((table) => table.code) ?? [];
};

describe("floor map built from the real layout", () => {
  it("has 45 tables, all vacant before anyone is seated", () => {
    const map = buildFloorMap(realRows());
    expect(map.tableCount).toBe(45);
    expect(map.counts).toEqual({ vacant: 45, "chips-needed": 0, "chips-served": 0, closed: 0 });
  });

  it("places areas like the drawing: A, B, C on top; Bar then X on the left; P and Party on the right", () => {
    const map = buildFloorMap(realRows());
    const placement = Object.fromEntries(map.areas.map((area) => [area.code, area.placement]));
    expect(placement.A).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 1 });
    expect(placement.C).toEqual({ row: 1, col: 3, rowSpan: 1, colSpan: 1 });
    expect(placement.BAR).toEqual({ row: 2, col: 1, rowSpan: 1, colSpan: 2 });
    expect(placement.X).toEqual({ row: 3, col: 1, rowSpan: 1, colSpan: 2 });
    expect(placement.P).toEqual({ row: 2, col: 3, rowSpan: 2, colSpan: 1 });
  });

  it("orders Section A row by row as drawn: A3 A4 / A2 A5 / A1 A6", () => {
    expect(codesIn("A")).toEqual(["A3", "A4", "A2", "A5", "A1", "A6"]);
  });

  it("draws X(1) and X(2) together in one X block on a 5 by 3 grid", () => {
    const x = buildFloorMap(realRows()).areas.find((area) => area.code === "X");
    expect(x?.grid).toEqual({ rows: 5, cols: 3 });
    expect(x?.sections.map((section) => section.name)).toEqual(["X(1)", "X(2)"]);
    expect(x?.tables).toHaveLength(14);
  });

  it("keeps Party areas beside P, and Bar 1 to Bar 4 in one row", () => {
    expect(codesIn("P")).toEqual(["P10", "P1", "PARTY-1", "P2", "P3", "PARTY-2", "P4", "P5", "PARTY-3"]);
    expect(codesIn("BAR")).toEqual(["BAR-1", "BAR-2", "BAR-3", "BAR-4"]);
  });

  it("lists the five approved combinations with summed chairs", () => {
    const combos = buildFloorMap(realRows()).combinations.map((c) => [c.label, c.capacity, c.allowsOverTwelve]);
    expect(combos).toEqual([
      ["A3 + A4", 10, false],
      ["B3 + B4", 10, false],
      ["C3 + C4", 10, false],
      ["A4 + B4", 12, false],
      ["X6 + X7 + X8", 18, true],
    ]);
  });

  it("shows tables in a closed section as closed", () => {
    const rows = realRows();
    rows.sections = rows.sections.map((section) => (section.code === "B" ? { ...section, is_open: false } : section));
    const map = buildFloorMap(rows);
    expect(map.counts.closed).toBe(6);
    expect(map.areas.find((area) => area.code === "B")?.tables.every((table) => table.status === "closed")).toBe(true);
  });

  it("hides inactive tables", () => {
    const rows = realRows();
    rows.tables = rows.tables.map((table) => (table.code === "P10" ? { ...table, is_active: false } : table));
    expect(buildFloorMap(rows).tableCount).toBe(44);
  });
});

describe("layout safety checks", () => {
  it("refuses two tables in one spot", () => {
    const rows = realRows();
    rows.tables = rows.tables.map((table) =>
      table.code === "A1" ? { ...table, layout_row: 1, layout_col: 1 } : table,
    );
    expect(() => buildFloorMap(rows)).toThrow(FloorLayoutError);
  });

  it("refuses a table in an unknown section", () => {
    const rows = realRows();
    rows.tables = rows.tables.map((table) => (table.code === "A1" ? { ...table, section_code: "Z" } : table));
    expect(() => buildFloorMap(rows)).toThrow(/unknown section/);
  });

  it("refuses a combination that points at a missing table", () => {
    const rows = realRows();
    rows.tables = rows.tables.filter((table) => table.code !== "X7");
    expect(() => buildFloorMap(rows)).toThrow(/unknown table/);
  });
});

describe("combined capacity", () => {
  it("is the sum of chairs", () => {
    expect(combinedCapacity([6, 6, 6])).toBe(18);
    expect(combinedCapacity([4, 6])).toBe(10);
  });

  it("is unknown when any table's chairs are unknown", () => {
    expect(combinedCapacity([4, null])).toBeNull();
    expect(combinedCapacity([])).toBeNull();
  });
});

describe("table status", () => {
  it("is green (vacant) with no visit in an open section", () => {
    expect(deriveTableStatus({ sectionOpen: true, visit: null })).toBe("vacant");
  });

  it("is gray (closed) with no visit in a closed section", () => {
    expect(deriveTableStatus({ sectionOpen: false, visit: null })).toBe("closed");
  });

  it("is yellow until chips are served, then red, even if the section closes meanwhile", () => {
    expect(deriveTableStatus({ sectionOpen: true, visit: { guestCount: 3, chipsServed: false } })).toBe("chips-needed");
    expect(deriveTableStatus({ sectionOpen: false, visit: { guestCount: 3, chipsServed: true } })).toBe("chips-served");
  });

  it("carries the guest count onto the map", () => {
    const rows = realRows();
    const a2 = rows.tables.find((table) => table.code === "A2");
    const map = buildFloorMap(rows, new Map([[a2!.id, { guestCount: 3, chipsServed: false }]]));
    const tile = map.areas.flatMap((area) => area.tables).find((table) => table.code === "A2");
    expect(tile).toMatchObject({ status: "chips-needed", guestCount: 3 });
    expect(map.counts["chips-needed"]).toBe(1);
  });
});

describe("natural order", () => {
  it("puts X6 before X10", () => {
    expect(["X10", "X6", "X8"].sort(naturalCompare)).toEqual(["X6", "X8", "X10"]);
  });
});
