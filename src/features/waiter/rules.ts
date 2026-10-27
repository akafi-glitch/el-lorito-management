/**
 * Waiter Section rules (owner decisions, Oct 26, 2026). Pure code, so they are easy to test.
 *
 * - A waiter types their employee number ("01" and "1" are the same number).
 * - Unknown and turned-off numbers are refused.
 * - The waiter sees the tables of the sections assigned to them this shift, plus the Bar.
 * - Any waiter can bill the Bar, so the Bar never shows a warning.
 * - A table in someone else's section may still be opened, after a warning that names the
 *   assigned waiter: "This table is assigned to Musfika (02). Do you want to continue?"
 * - Only a table with seated guests can be opened: tickets belong to a customer visit, and
 *   visits start when guests are seated on the Floor.
 */

import type { FloorMap, FloorTable, SectionInfo } from "@/features/floor/layout";
import { employeeLabel, type EmployeeRef } from "@/features/staff/rules";

export const EMPLOYEE_NUMBER_MAX_DIGITS = 6;

/** Who waits each section right now, keyed by section code. */
export type WaiterBySection = ReadonlyMap<string, Pick<EmployeeRef, "id" | "name" | "number">>;

export type LookupResult =
  | { ok: true; employee: EmployeeRef }
  | { ok: false; message: string };

/** Turns the database's answer for a typed number into what the waiter sees. */
export function lookupResult(typed: string, employee: EmployeeRef | null): LookupResult {
  const shown = typed.trim();
  if (!employee) return { ok: false, message: `No employee has number ${shown}. Check the number and try again.` };
  if (!employee.isActive) {
    return { ok: false, message: `${employeeLabel(employee)} is turned off. Ask a manager to turn the number back on.` };
  }
  return { ok: true, employee };
}

/** How a waiter relates to a table: theirs, the shared Bar, or another section. */
export type TableAccess =
  | { kind: "own" }
  | { kind: "bar" }
  | { kind: "other"; sectionName: string; assignedTo: string | null };

export function tableAccess(table: Pick<FloorTable, "section">, me: Pick<EmployeeRef, "id">, waiters: WaiterBySection): TableAccess {
  if (table.section.openToAllWaiters) return { kind: "bar" };
  const assigned = waiters.get(table.section.code);
  if (assigned?.id === me.id) return { kind: "own" };
  return { kind: "other", sectionName: table.section.name, assignedTo: assigned ? employeeLabel(assigned) : null };
}

/** The confirmation shown before opening a table outside the waiter's sections, or null. */
export function crossSectionWarning(access: TableAccess): string | null {
  if (access.kind !== "other") return null;
  if (access.assignedTo) return `This table is assigned to ${access.assignedTo}. Do you want to continue?`;
  return `This table is in section ${access.sectionName}, which isn't assigned to you. Do you want to continue?`;
}

/** Why a table can't be opened yet, or null when it can. */
export function openTableProblem(table: Pick<FloorTable, "label" | "visit">): string | null {
  if (table.visit) return null;
  return `No guests are seated at ${table.label}. Seat them on the Floor first.`;
}

export type WaiterTableGroup = {
  section: SectionInfo;
  /** "Musfika (02)" for other sections; null when nobody is assigned (or for your own and the Bar). */
  assignedTo: string | null;
  access: TableAccess["kind"];
  tables: FloorTable[];
};

export type WaiterView = {
  /** Sections assigned to this waiter this shift, in floor order. */
  mySections: SectionInfo[];
  /** Your sections first, then the Bar, then everything else. */
  mine: WaiterTableGroup[];
  bar: WaiterTableGroup[];
  others: WaiterTableGroup[];
};

/** Groups the floor's tables for one waiter. */
export function buildWaiterView(map: Pick<FloorMap, "areas" | "sections">, me: Pick<EmployeeRef, "id">, waiters: WaiterBySection): WaiterView {
  const tablesBySection = new Map<string, FloorTable[]>();
  for (const table of map.areas.flatMap((area) => area.tables)) {
    const list = tablesBySection.get(table.section.code) ?? [];
    list.push(table);
    tablesBySection.set(table.section.code, list);
  }

  const view: WaiterView = { mySections: [], mine: [], bar: [], others: [] };
  for (const section of map.sections) {
    const tables = (tablesBySection.get(section.code) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    if (tables.length === 0) continue;
    const access = tableAccess({ section }, me, waiters);
    const group: WaiterTableGroup = {
      section,
      assignedTo: access.kind === "other" ? access.assignedTo : null,
      access: access.kind,
      tables,
    };
    if (access.kind === "own") {
      view.mySections.push(section);
      view.mine.push(group);
    } else if (access.kind === "bar") {
      view.bar.push(group);
    } else {
      view.others.push(group);
    }
  }
  return view;
}

/** Keeps only digits and caps the length, for the on-screen number pad and typed input alike. */
export function cleanTypedNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, EMPLOYEE_NUMBER_MAX_DIGITS);
}

/** Where a waiter's own pages start: "/waiter/01". */
export function waiterPath(employee: Pick<EmployeeRef, "number">): string {
  return `/waiter/${encodeURIComponent(employee.number)}`;
}

/** A table's page for this waiter; "continue" records that the warning was confirmed. */
export function tablePath(basePath: string, table: Pick<FloorTable, "code">, confirmed: boolean): string {
  return `${basePath}/tables/${encodeURIComponent(table.code)}${confirmed ? "?continue=1" : ""}`;
}
