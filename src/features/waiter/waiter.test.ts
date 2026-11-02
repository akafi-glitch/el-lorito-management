import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildFloorMap } from "@/features/floor/layout";
import { combinationRowSchema, floorAreaRowSchema, sectionRowSchema, tableRowSchema } from "@/features/floor/schema";
import type { VisitSnapshot } from "@/features/floor/status";
import type { EmployeeRef } from "@/features/staff/rules";

import fixture from "../../../tests/fixtures/floor-rows.json";

import { assignedSections, cleanTypedNumber, lookupResult, pickerSections, tablePath, waiterPath, type WaiterBySection } from "./rules";
import { employeeNumberSchema, tableCodeSchema } from "./schema";

const rows = {
  areas: z.array(floorAreaRowSchema).parse(fixture.areas),
  sections: z.array(sectionRowSchema).parse(fixture.sections),
  tables: z.array(tableRowSchema).parse(fixture.tables),
  combinations: z.array(combinationRowSchema).parse(fixture.combinations),
};

const kafi: EmployeeRef = { id: 1, number: "01", name: "Kafi", role: "waiter", isActive: true };
const musfika: EmployeeRef = { id: 2, number: "02", name: "Musfika", role: "waiter", isActive: true };

const visits = new Map<string, VisitSnapshot>([
  [rows.tables.find((t) => t.code === "X2")!.id, { visitId: 1, version: 1, guestCount: 4, chipsServed: false, tableLabels: ["X2"] }],
]);
const sections = pickerSections(buildFloorMap(rows, { visits }));
const tablesOf = (code: string) => sections.find((section) => section.code === code)?.tables.map((table) => table.code);

describe("employee lookup", () => {
  it("accepts an active employee", () => {
    expect(lookupResult("01", kafi)).toEqual({ ok: true, employee: kafi });
  });

  it("refuses an unknown number and says which number", () => {
    expect(lookupResult(" 77 ", null)).toEqual({ ok: false, message: "No employee has number 77. Check the number and try again." });
  });

  it("refuses a turned-off employee by name", () => {
    expect(lookupResult("01", { ...kafi, isActive: false })).toEqual({
      ok: false,
      message: "Kafi (01) is turned off. Ask a manager to turn the number back on.",
    });
  });

  it("validates typed numbers: digits only, 1 to 6 of them", () => {
    expect(employeeNumberSchema.safeParse(" 01 ").success).toBe(true);
    expect(employeeNumberSchema.safeParse("").success).toBe(false);
    expect(employeeNumberSchema.safeParse("abc").success).toBe(false);
    expect(employeeNumberSchema.safeParse("1234567").success).toBe(false);
  });

  it("the number pad keeps digits only and stops at six", () => {
    expect(cleanTypedNumber("a0-1")).toBe("01");
    expect(cleanTypedNumber("12345678")).toBe("123456");
  });
});

describe("the section and table dropdowns", () => {
  it("offer every section in floor order", () => {
    expect(sections.map((section) => section.name)).toEqual(["A", "B", "C", "X(1)", "X(2)", "P", "Party", "Bar"]);
  });

  it("X(1) lists exactly X4, X5, X6, X7, X8, X9, X13, X14", () => {
    expect(tablesOf("X-1")).toEqual(["X4", "X5", "X6", "X7", "X8", "X9", "X13", "X14"]);
  });

  it("X(2) lists exactly X1, X2, X3, X10, X11, X12", () => {
    expect(tablesOf("X-2")).toEqual(["X1", "X2", "X3", "X10", "X11", "X12"]);
  });

  it("every table of the floor can be chosen, one section each", () => {
    const listed = sections.flatMap((section) => section.tables.map((table) => table.code));
    expect(listed).toHaveLength(45);
    expect(new Set(listed).size).toBe(45);
  });

  it("each table says whether anyone is seated there", () => {
    expect(sections.find((s) => s.code === "X-2")?.tables[1]).toEqual({ code: "X2", label: "X2", detail: "4 seated" });
    expect(sections.find((s) => s.code === "X-2")?.tables[0]).toEqual({ code: "X1", label: "X1", detail: "vacant" });
  });

  it("use the same table codes as the Floor", () => {
    const floorCodes = rows.tables.map((table) => table.code).sort();
    expect(sections.flatMap((section) => section.tables.map((table) => table.code)).sort()).toEqual(floorCodes);
  });
});

describe("section assignments", () => {
  const waiters: WaiterBySection = new Map([
    ["X-1", kafi],
    ["B", musfika],
    ["A", musfika],
  ]);

  it("are shown to the waiter, for information", () => {
    expect(assignedSections(sections, kafi, waiters).map((section) => section.name)).toEqual(["X(1)"]);
    expect(assignedSections(sections, musfika, waiters).map((section) => section.name)).toEqual(["A", "B"]);
  });

  it("a waiter with no section still gets every table", () => {
    expect(assignedSections(sections, { id: 99 }, waiters)).toEqual([]);
    expect(sections.length).toBe(8);
  });
});

describe("links", () => {
  it("are built for the waiter and the table, with no other-section confirmation", () => {
    expect(waiterPath(kafi)).toBe("/waiter/01");
    expect(tablePath("/waiter/01", "BAR-2")).toBe("/waiter/01/tables/BAR-2");
  });

  it("accept real table codes and nothing else", () => {
    expect(tableCodeSchema.safeParse("X10").success).toBe(true);
    expect(tableCodeSchema.safeParse("BAR-2").success).toBe(true);
    expect(tableCodeSchema.safeParse("x10").success).toBe(false);
    expect(tableCodeSchema.safeParse("../etc").success).toBe(false);
  });
});
