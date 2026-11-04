import "server-only";

import { z } from "zod";

import { TO_GO_SECTION } from "@/features/floor/layout";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import { buildBoard, DUTIES, ROLES, type AccountRef, type BoardRow, type EmployeeRef } from "./rules";

const employeeRow = z.object({
  id: z.number().int().positive(),
  employee_number: z.string(),
  full_name: z.string(),
  role_code: z.enum(ROLES),
  is_active: z.boolean(),
});
const sectionRow = z.object({ code: z.string(), name: z.string(), open_to_all_waiters: z.boolean(), sort_order: z.number() });
const nextSectionRow = z.object({ next_section_code: z.string() });
const rotationRow = z.object({ section_code: z.string(), section_position: z.number().int().positive() });
const assignmentRow = z.object({ section_code: z.string(), duty: z.enum(DUTIES), employee_id: z.number().int().positive() });
const shiftRow = z.object({ id: z.number().int().positive(), started_at: z.string() });
const openTicketRow = z.object({ ticket_number: z.number().int().positive(), table_labels: z.string().nullable(), total_cents: z.number().int() });
const accountRow = z.object({
  user_id: z.guid(),
  username: z.string(),
  display_name: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
});

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

/** "Mon, Oct 26, 4:02 PM" in the restaurant's time zone. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: serverEnv().APP_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "4:02 PM" in the restaurant's time zone. */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: serverEnv().APP_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export async function loadEmployees(): Promise<EmployeeRef[]> {
  const { data, error } = await createAdminClient()
    .from("employees")
    .select("id, employee_number, full_name, role_code, is_active");
  if (error) fail("employees", error);
  return z
    .array(employeeRow)
    .parse(data)
    .map((row) => ({ id: row.id, number: row.employee_number, name: row.full_name, role: row.role_code, isActive: row.is_active }))
    .sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
}

export type StaffBoard = {
  shift: { id: number; startedAt: string } | null;
  rows: BoardRow[];
  employees: EmployeeRef[];
  /** The open shift's rotation in order (the default order when no shift is open). */
  rotation: { code: string; name: string }[];
  nextSection: string | null;
  /** Tickets not finished yet, for the warning before a shift is finished. */
  openTickets: { number: number; tables: string | null; totalCents: number }[];
};

export async function loadStaffBoard(): Promise<StaffBoard> {
  const db = createAdminClient();
  const [shift, sections, assignments, employees, rotation, nextSection, openTickets] = await Promise.all([
    db.from("shifts").select("id, started_at").is("ended_at", null).maybeSingle(),
    db.from("sections").select("code, name, open_to_all_waiters, sort_order").neq("code", TO_GO_SECTION),
    db.from("current_assignments").select("section_code, duty, employee_id"),
    loadEmployees(),
    db.rpc("current_rotation"),
    db.from("rotation_state").select("next_section_code").maybeSingle(),
    db.from("ticket_history").select("ticket_number, table_labels, total_cents").eq("status", "open").order("ticket_number"),
  ]);
  if (shift.error) fail("the shift", shift.error);
  if (sections.error) fail("sections", sections.error);
  if (assignments.error) fail("assignments", assignments.error);
  if (rotation.error) fail("the rotation", rotation.error);
  if (nextSection.error) fail("the rotation", nextSection.error);
  if (openTickets.error) fail("the open tickets", openTickets.error);

  const openShift = shift.data ? shiftRow.parse(shift.data) : null;
  const sectionRefs = z
    .array(sectionRow)
    .parse(sections.data)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => ({ code: row.code, name: row.name, openToAllWaiters: row.open_to_all_waiters }));
  const current = z
    .array(assignmentRow)
    .parse(assignments.data)
    .map((row) => ({ sectionCode: row.section_code, duty: row.duty, employeeId: row.employee_id }));

  return {
    shift: openShift ? { id: openShift.id, startedAt: formatTime(openShift.started_at) } : null,
    rows: buildBoard(sectionRefs, current, employees),
    employees,
    rotation: z
      .array(rotationRow)
      .parse(rotation.data)
      .sort((a, b) => a.section_position - b.section_position)
      .map((row) => ({
        code: row.section_code,
        name: sectionRefs.find((section) => section.code === row.section_code)?.name ?? row.section_code,
      })),
    nextSection: nextSection.data ? nextSectionRow.parse(nextSection.data).next_section_code : null,
    openTickets: z
      .array(openTicketRow)
      .parse(openTickets.data)
      .map((row) => ({ number: row.ticket_number, tables: row.table_labels, totalCents: row.total_cents })),
  };
}

export type AccountListItem = AccountRef & { createdAt: string };

export async function loadAccounts(): Promise<AccountListItem[]> {
  const { data, error } = await createAdminClient()
    .from("app_users")
    .select("user_id, username, display_name, is_active, created_at")
    .order("username");
  if (error) fail("accounts", error);
  return z
    .array(accountRow)
    .parse(data)
    .map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      isActive: row.is_active,
      createdAt: formatTime(row.created_at),
    }));
}
