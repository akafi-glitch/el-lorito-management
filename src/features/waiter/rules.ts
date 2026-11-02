/**
 * Waiter Section rules (owner decisions, Oct 26 and Nov 2, 2026). Pure code, so they are easy to test.
 *
 * - A waiter types their employee number ("01" and "1" are the same number).
 * - Unknown and turned-off numbers are refused.
 * - A waiter may open ANY table: section assignments are for floor management and never block ordering.
 * - Tables come from the same database rows as the Floor, so both talk about the same table and visit.
 */

import type { FloorMap } from "@/features/floor/layout";
import { STATUS_LABEL } from "@/features/floor/status";
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

export type PickerTable = { code: string; label: string; detail: string };
export type PickerSection = { code: string; name: string; tables: PickerTable[] };

/** Every section with its tables, in floor order, for the two dropdowns. */
export function pickerSections(map: Pick<FloorMap, "areas" | "sections">): PickerSection[] {
  const tables = map.areas.flatMap((area) => area.tables);
  return map.sections.flatMap((section) => {
    const list = tables.filter((table) => table.section.code === section.code).sort((a, b) => a.sortOrder - b.sortOrder);
    if (list.length === 0) return [];
    return [
      {
        code: section.code,
        name: section.name,
        tables: list.map((table) => ({
          code: table.code,
          label: table.label,
          detail: table.visit ? `${table.visit.guestCount} seated` : STATUS_LABEL[table.status].toLowerCase(),
        })),
      },
    ];
  });
}

/** The sections assigned to this waiter this shift: shown for information, and picked first. */
export function assignedSections(sections: readonly Pick<PickerSection, "code" | "name">[], me: Pick<EmployeeRef, "id">, waiters: WaiterBySection) {
  return sections.filter((section) => waiters.get(section.code)?.id === me.id);
}

/** Keeps only digits and caps the length, for the on-screen number pad and typed input alike. */
export function cleanTypedNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, EMPLOYEE_NUMBER_MAX_DIGITS);
}

/** Where a waiter's own pages start: "/waiter/01". */
export function waiterPath(employee: Pick<EmployeeRef, "number">): string {
  return `/waiter/${encodeURIComponent(employee.number)}`;
}

/** A table's page for this waiter. */
export function tablePath(basePath: string, tableCode: string): string {
  return `${basePath}/tables/${encodeURIComponent(tableCode)}`;
}
