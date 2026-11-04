/**
 * Waiter Section rules (owner decisions, Oct 26 and Nov 2, 2026). Pure code, so they are easy to test.
 *
 * - A waiter types their employee number ("01" and "1" are the same number).
 * - Unknown and turned-off numbers are refused.
 * - A waiter may open ANY table: section assignments are for floor management and never block ordering.
 * - The Waiter Section is separate from the Floor: whether a table is seated, and how many guests, never
 *   matters here. Choosing a table goes straight to its order page.
 * - A table with a saved order still needing its kitchen receipt is green. Once every order's receipt is
 *   confirmed printed it is blue, until the ticket is finished.
 * - Between shifts the restaurant is closed: nobody enters until a manager starts a shift.
 * - To-go orders start from the section dropdown and go straight to the menu, with no table to choose.
 */

import type { FloorMap } from "@/features/floor/layout";
import { employeeLabel, type EmployeeRef } from "@/features/staff/rules";
import type { KitchenMark } from "@/features/tickets/rules";

export const EMPLOYEE_NUMBER_MAX_DIGITS = 6;

export const RESTAURANT_CLOSED_TEXT = "The restaurant is closed. A manager needs to start the shift first.";

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

export type PickerTable = { code: string; label: string; kitchen: KitchenMark | null };
export type PickerSection = { code: string; name: string; tables: PickerTable[] };

/** Every section with its tables, in floor order, for the picker. */
export function pickerSections(map: Pick<FloorMap, "areas" | "sections">, kitchen: ReadonlyMap<string, KitchenMark>): PickerSection[] {
  const tables = map.areas.flatMap((area) => area.tables);
  return map.sections.flatMap((section) => {
    const list = tables.filter((table) => table.section.code === section.code).sort((a, b) => a.sortOrder - b.sortOrder);
    if (list.length === 0) return [];
    return [
      {
        code: section.code,
        name: section.name,
        tables: list.map((table) => ({ code: table.code, label: table.label, kitchen: kitchen.get(table.code) ?? null })),
      },
    ];
  });
}

/** The sections a manager gave this waiter this shift: their tables, shown first. */
export function assignedSections<T extends Pick<PickerSection, "code">>(sections: readonly T[], me: Pick<EmployeeRef, "id">, waiters: WaiterBySection): T[] {
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
/** The page for a new to-go order. */
export function toGoPath(basePath: string): string {
  return `${basePath}/to-go`;
}

export function tablePath(basePath: string, tableCode: string): string {
  return `${basePath}/tables/${encodeURIComponent(tableCode)}`;
}
