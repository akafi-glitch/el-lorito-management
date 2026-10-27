import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { testEnv } from "./env";

/**
 * Test data through the same database functions the app uses (server role, local Supabase only).
 * Every helper is safe to run again: tests start by freeing the tables they use.
 */

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!client) {
    const env = testEnv();
    client = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message} ${error.details ?? ""}`.trim());
  return data as T;
}

export async function startShift(): Promise<number> {
  return rpc<number>("start_shift", { p_actor: null });
}

/** An employee with this number, active, with this name and role (added the first time). */
export async function employee(number: string, name: string, role: "waiter" | "chips_runner" | "manager"): Promise<number> {
  const key = number.replace(/^0+/, "") || "0";
  const { data, error } = await db().from("employees").select("id").eq("number_key", key).maybeSingle();
  if (error) throw error;
  if (data) {
    await rpc("update_employee", { p_employee_id: data.id, p_full_name: name, p_role: role, p_is_active: true, p_actor: null });
    return data.id as number;
  }
  return rpc<number>("add_employee", { p_number: number, p_full_name: name, p_role: role, p_actor: null });
}

export async function setEmployeeActive(id: number, name: string, active: boolean): Promise<void> {
  await rpc("update_employee", { p_employee_id: id, p_full_name: name, p_role: "waiter", p_is_active: active, p_actor: null });
}

export async function assign(section: string, duty: "waiter" | "chips_runner", employeeId: number | null): Promise<void> {
  await rpc("assign_duty", { p_section_code: section, p_duty: duty, p_employee_id: employeeId, p_actor: null });
}

/** Clears any group seated at these tables (chips first, as the floor requires), and opens their sections. */
export async function freeTables(codes: string[]): Promise<void> {
  const { data: tables, error } = await db().from("restaurant_tables").select("id, section_code").in("code", codes);
  if (error) throw error;
  for (const section of new Set((tables ?? []).map((t) => t.section_code as string))) {
    await rpc("set_section_open", { p_section_code: section, p_is_open: true, p_actor: null });
  }
  const { data: open, error: openError } = await db()
    .from("visit_tables")
    .select("visit_id")
    .in("table_id", (tables ?? []).map((t) => t.id))
    .is("released_at", null);
  if (openError) throw openError;
  for (const visitId of new Set((open ?? []).map((row) => row.visit_id as number))) {
    let { data: visit } = await db().from("customer_visits").select("version, chips_status").eq("id", visitId).single();
    if (visit?.chips_status === "needed") {
      await rpc("mark_chips_served", { p_visit_id: visitId, p_expected_version: visit.version, p_actor: null });
      ({ data: visit } = await db().from("customer_visits").select("version, chips_status").eq("id", visitId).single());
    }
    await rpc("clear_visit", { p_visit_id: visitId, p_expected_version: visit!.version, p_actor: null });
  }
}

export async function seat(codes: string[], guests: number): Promise<number> {
  await freeTables(codes);
  return rpc<number>("seat_party", { p_table_codes: codes, p_guest_count: guests, p_actor: null });
}

export async function itemId(name: string): Promise<number> {
  const { data, error } = await db().from("menu_items").select("id").eq("name", name).order("id").limit(1).single();
  if (error) throw error;
  return data.id as number;
}

export async function setItem(name: string, priceCents: number, available: boolean): Promise<void> {
  await rpc("update_menu_item", { p_item_id: await itemId(name), p_price_cents: priceCents, p_is_available: available, p_actor: null });
}

export async function menuItem(name: string): Promise<{ price_cents: number; is_available: boolean }> {
  const { data, error } = await db().from("menu_items").select("price_cents, is_available").eq("name", name).order("id").limit(1).single();
  if (error) throw error;
  return data;
}

/** Saves a ticket the way a second device would. */
export async function saveTicket(visitId: number, employeeId: number, lines: [string, number][], ticket?: { id: number; version: number }) {
  const items = await Promise.all(lines.map(async ([name, quantity]) => ({ item_id: await itemId(name), quantity })));
  const rows = await rpc<{ ticket_id: number; ticket_number: number; version: number }[]>("save_ticket", {
    p_visit_id: visitId,
    p_ticket_id: ticket?.id ?? null,
    p_expected_version: ticket?.version ?? null,
    p_employee_id: employeeId,
    p_lines: items,
    p_time_zone: "America/Chicago",
    p_actor: null,
  });
  return rows[0]!;
}

export async function ticketByNumber(number: number) {
  const { data, error } = await db().from("tickets").select("id, status, version, total_cents, visit_id").eq("ticket_number", number).single();
  if (error) throw error;
  return data;
}

export async function printAttempts(ticketId: number) {
  const { data, error } = await db().from("print_attempts").select("attempt_no, kind, outcome").eq("ticket_id", ticketId).order("attempt_no");
  if (error) throw error;
  return data;
}

export async function ticketTotal(number: number): Promise<number> {
  const { data, error } = await db().from("ticket_totals").select("total_cents").eq("ticket_number", number).single();
  if (error) throw error;
  return data.total_cents as number;
}

export async function visitCleared(visitId: number): Promise<boolean> {
  const { data, error } = await db().from("customer_visits").select("cleared_at").eq("id", visitId).single();
  if (error) throw error;
  return data.cleared_at !== null;
}
