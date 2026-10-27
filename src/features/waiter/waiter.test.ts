import { describe, expect, it } from "vitest";
import { z } from "zod";

import fixture from "../../../tests/fixtures/floor-rows.json";
import { buildFloorMap, allTables } from "@/features/floor/layout";
import { combinationRowSchema, floorAreaRowSchema, sectionRowSchema, tableRowSchema, type FloorRows } from "@/features/floor/schema";
import type { VisitSnapshot } from "@/features/floor/status";
import type { EmployeeRef } from "@/features/staff/rules";

import {
  buildWaiterView,
  cleanTypedNumber,
  crossSectionWarning,
  lookupResult,
  openTableProblem,
  tableAccess,
  tablePath,
  waiterPath,
  type WaiterBySection,
} from "./rules";
import { employeeNumberSchema, tableCodeSchema } from "./schema";

function realRows(): FloorRows {
  return {
    areas: z.array(floorAreaRowSchema).parse(fixture.areas),
    sections: z.array(sectionRowSchema).parse(fixture.sections),
    tables: z.array(tableRowSchema).parse(fixture.tables),
    combinations: z.array(combinationRowSchema).parse(fixture.combinations),
  };
}

const kafi: EmployeeRef = { id: 1, number: "01", name: "Kafi", role: "waiter", isActive: true };
const musfika: EmployeeRef = { id: 2, number: "02", name: "Musfika", role: "waiter", isActive: true };
const rahim: EmployeeRef = { id: 3, number: "03", name: "Rahim", role: "waiter", isActive: true };

/** Kafi on X(1), Musfika on B and A. */
const waiters: WaiterBySection = new Map([
  ["X-1", kafi],
  ["B", musfika],
  ["A", musfika],
]);

function floorWith(seated: Record<string, number> = {}) {
  const rows = realRows();
  const visits = new Map<string, VisitSnapshot>();
  let id = 1;
  for (const [code, guests] of Object.entries(seated)) {
    const table = rows.tables.find((t) => t.code === code)!;
    visits.set(table.id, { visitId: id, version: 1, guestCount: guests, chipsServed: false, tableLabels: [table.label] });
    id += 1;
  }
  return buildFloorMap(rows, { visits });
}

const table = (map: ReturnType<typeof floorWith>, code: string) => allTables(map).find((t) => t.code === code)!;

describe("employee lookup", () => {
  it("accepts an active employee", () => {
    expect(lookupResult("01", kafi)).toEqual({ ok: true, employee: kafi });
  });

  it("refuses an unknown number and says which number", () => {
    expect(lookupResult(" 77 ", null)).toEqual({ ok: false, message: "No employee has number 77. Check the number and try again." });
  });

  it("refuses a turned-off employee by name", () => {
    const result = lookupResult("4", { id: 9, number: "04", name: "Luis", role: "waiter", isActive: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Luis (04) is turned off. Ask a manager to turn the number back on.");
  });

  it("validates typed numbers: digits only, 1 to 6 of them", () => {
    expect(employeeNumberSchema.safeParse(" 01 ").data).toBe("01");
    expect(employeeNumberSchema.safeParse("").success).toBe(false);
    expect(employeeNumberSchema.safeParse("1a").success).toBe(false);
    expect(employeeNumberSchema.safeParse("1234567").success).toBe(false);
  });

  it("the number pad keeps digits only and stops at six", () => {
    expect(cleanTypedNumber("0 1-x")).toBe("01");
    expect(cleanTypedNumber("12345678")).toBe("123456");
  });
});

describe("which tables a waiter sees", () => {
  it("shows the waiter's own section first, then the Bar, then other sections", () => {
    const view = buildWaiterView(floorWith(), kafi, waiters);
    expect(view.mySections.map((s) => s.name)).toEqual(["X(1)"]);
    expect(view.mine[0]?.tables.map((t) => t.code)).toEqual(["X1", "X2", "X3", "X9", "X10", "X11", "X12"]);
    expect(view.bar.map((g) => g.section.code)).toEqual(["BAR"]);
    expect(view.bar[0]?.tables).toHaveLength(4);
    expect(view.others.map((g) => g.section.code)).toEqual(["A", "B", "C", "X-2", "P", "PARTY"]);
  });

  it("names the assigned waiter on other sections, or nobody", () => {
    const view = buildWaiterView(floorWith(), kafi, waiters);
    const assigned = Object.fromEntries(view.others.map((g) => [g.section.code, g.assignedTo]));
    expect(assigned.B).toBe("Musfika (02)");
    expect(assigned.C).toBeNull();
  });

  it("a waiter on two sections sees both as theirs", () => {
    const view = buildWaiterView(floorWith(), musfika, waiters);
    expect(view.mySections.map((s) => s.code)).toEqual(["A", "B"]);
  });

  it("an unassigned waiter has no sections of their own, but still sees the Bar and everything else", () => {
    const view = buildWaiterView(floorWith(), rahim, waiters);
    expect(view.mine).toEqual([]);
    expect(view.bar).toHaveLength(1);
    expect(view.others.flatMap((g) => g.tables)).toHaveLength(45 - 4);
  });

  it("follows the latest assignment: moving Kafi from X(1) to B moves his tables", () => {
    const moved: WaiterBySection = new Map([["B", kafi]]);
    const view = buildWaiterView(floorWith(), kafi, moved);
    expect(view.mySections.map((s) => s.code)).toEqual(["B"]);
  });
});

describe("cross-section warning", () => {
  const map = floorWith({ B3: 4, X2: 2, "BAR-1": 1, C1: 3 });

  it("warns with the owner's exact words for another waiter's table", () => {
    const access = tableAccess(table(map, "B3"), kafi, waiters);
    expect(access).toEqual({ kind: "other", sectionName: "B", assignedTo: "Musfika (02)" });
    expect(crossSectionWarning(access)).toBe("This table is assigned to Musfika (02). Do you want to continue?");
  });

  it("does not warn for the waiter's own table", () => {
    expect(crossSectionWarning(tableAccess(table(map, "X2"), kafi, waiters))).toBeNull();
  });

  it("never warns for the Bar", () => {
    const access = tableAccess(table(map, "BAR-1"), kafi, waiters);
    expect(access).toEqual({ kind: "bar" });
    expect(crossSectionWarning(access)).toBeNull();
  });

  it("warns for a section with no waiter, naming the section", () => {
    expect(crossSectionWarning(tableAccess(table(map, "C1"), kafi, waiters))).toBe(
      "This table is in section C, which isn't assigned to you. Do you want to continue?",
    );
  });

  it("warns an unassigned waiter on every table except the Bar", () => {
    const warned = allTables(map).filter((t) => crossSectionWarning(tableAccess(t, rahim, waiters)) !== null);
    expect(warned).toHaveLength(45 - 4);
  });
});

describe("opening a table", () => {
  const map = floorWith({ X2: 4 });

  it("opens a table with seated guests", () => {
    expect(openTableProblem(table(map, "X2"))).toBeNull();
  });

  it("refuses a table with nobody seated", () => {
    expect(openTableProblem(table(map, "X3"))).toBe("No guests are seated at X3. Seat them on the Floor first.");
  });

  it("builds links for the waiter and the table, with the confirmation flag", () => {
    expect(waiterPath(kafi)).toBe("/waiter/01");
    expect(tablePath("/waiter/01", { code: "BAR-2" }, false)).toBe("/waiter/01/tables/BAR-2");
    expect(tablePath("/waiter/01", { code: "B3" }, true)).toBe("/waiter/01/tables/B3?continue=1");
  });

  it("accepts real table codes in links and nothing else", () => {
    for (const code of ["A1", "X10", "BAR-4", "PARTY-2"]) expect(tableCodeSchema.safeParse(code).success).toBe(true);
    for (const code of ["", "a1", "A1;drop", "../x"]) expect(tableCodeSchema.safeParse(code).success).toBe(false);
  });
});
