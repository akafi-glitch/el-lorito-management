import "server-only";

import { z } from "zod";

import { loadFloorMap } from "@/features/floor/queries";
import { employeeNumberKey, ROLES, type EmployeeRef } from "@/features/staff/rules";
import { createAdminClient } from "@/lib/supabase/admin";

import { buildWaiterView, type WaiterBySection, type WaiterView } from "./rules";

const employeeRow = z.object({
  id: z.number().int().positive(),
  employee_number: z.string(),
  full_name: z.string(),
  role_code: z.enum(ROLES),
  is_active: z.boolean(),
});

const waiterRow = z.object({
  section_code: z.string(),
  employee_id: z.number().int().positive(),
  full_name: z.string(),
  employee_number: z.string(),
});

/** Finds an employee by the number they typed ("1" finds "01"). Null when nobody has it. */
export async function findEmployeeByNumber(typed: string): Promise<EmployeeRef | null> {
  const { data, error } = await createAdminClient()
    .from("employees")
    .select("id, employee_number, full_name, role_code, is_active")
    .eq("number_key", employeeNumberKey(typed))
    .maybeSingle();
  if (error) throw new Error(`Could not look up the employee: ${error.message}`);
  if (!data) return null;
  const row = employeeRow.parse(data);
  return { id: row.id, number: row.employee_number, name: row.full_name, role: row.role_code, isActive: row.is_active };
}

/** The waiter on each section in the open shift. */
export async function loadWaitersBySection(): Promise<WaiterBySection> {
  const { data, error } = await createAdminClient()
    .from("current_assignments")
    .select("section_code, employee_id, full_name, employee_number")
    .eq("duty", "waiter");
  if (error) throw new Error(`Could not load the waiter assignments: ${error.message}`);
  return new Map(
    z
      .array(waiterRow)
      .parse(data)
      .map((row) => [row.section_code, { id: row.employee_id, name: row.full_name, number: row.employee_number }]),
  );
}

export type WaiterScreen = {
  view: WaiterView;
  waiters: WaiterBySection;
  floor: Awaited<ReturnType<typeof loadFloorMap>>;
};

/** Everything the "your tables" screen needs, read in parallel. */
export async function loadWaiterScreen(me: Pick<EmployeeRef, "id">): Promise<WaiterScreen> {
  const [floor, waiters] = await Promise.all([loadFloorMap(), loadWaitersBySection()]);
  return { view: buildWaiterView(floor, me, waiters), waiters, floor };
}
