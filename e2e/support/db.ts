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

export async function startShift(rotation?: string[]): Promise<number> {
  return rpc<number>("start_shift", { p_actor: null, ...(rotation ? { p_rotation: rotation } : {}) });
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
    let visit = await visitRow(visitId);
    if (visit.chips_status === "needed") {
      await rpc("mark_chips_served", { p_visit_id: visitId, p_expected_version: visit.version, p_actor: null });
      visit = await visitRow(visitId);
    }
    await rpc("clear_visit", { p_visit_id: visitId, p_expected_version: visit.version, p_actor: null });
  }
}

export async function visitRow(visitId: number): Promise<{ version: number; chips_status: "needed" | "served"; cleared_at: string | null }> {
  const { data, error } = await db().from("customer_visits").select("version, chips_status, cleared_at").eq("id", visitId).single();
  if (error) throw error;
  return data;
}

export async function seat(codes: string[], guests: number, combination?: string): Promise<number> {
  await freeTables(codes);
  return rpc<number>("seat_party", { p_table_codes: codes, p_guest_count: guests, p_actor: null, ...(combination ? { p_combination_code: combination } : {}) });
}

/** What another employee's device does. */
export async function serveChips(visitId: number): Promise<number> {
  return rpc<number>("mark_chips_served", { p_visit_id: visitId, p_expected_version: (await visitRow(visitId)).version, p_actor: null });
}

export async function clearVisit(visitId: number): Promise<number> {
  return rpc<number>("clear_visit", { p_visit_id: visitId, p_expected_version: (await visitRow(visitId)).version, p_actor: null });
}

export async function audit(visitId: number): Promise<string[]> {
  const { data, error } = await db().from("audit_events").select("event_type").eq("visit_id", visitId).order("id");
  if (error) throw error;
  return data.map((row) => row.event_type as string);
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

/** Saves an order the way a second device would. */
export async function saveOrder(tableCode: string, employeeId: number, lines: [string, number][], notes: string | null = null) {
  const items = await Promise.all(lines.map(async ([name, quantity]) => ({ item_id: await itemId(name), quantity })));
  const rows = await rpc<{ ticket_id: number; ticket_number: number; version: number; batch_id: number; batch_no: number }[]>("save_table_order", {
    p_table_code: tableCode,
    p_employee_id: employeeId,
    p_client_key: crypto.randomUUID(),
    p_lines: items,
    p_notes: notes,
    p_time_zone: "America/Chicago",
    p_actor: null,
  });
  return rows[0]!;
}

export async function ticketByNumber(number: number) {
  const { data, error } = await db().from("tickets").select("id, status, version, total_cents, visit_id, employee_id, final_receipt").eq("ticket_number", number).single();
  if (error) throw error;
  return data;
}

/** The open ticket of a table, in a list: there is never more than one. */
export async function openTicketsAt(tableCode: string) {
  const { data, error } = await db()
    .from("tickets")
    .select("id, ticket_number, status, version, total_cents, employee_id, visit_id, restaurant_tables!inner(code)")
    .eq("restaurant_tables.code", tableCode)
    .eq("status", "open")
    .eq("legacy_single_order", false);
  if (error) throw error;
  return data;
}

/** The customer receipt of an open ticket, confirmed printed. */
export async function finalizeTicket(ticketId: number, employeeId: number) {
  const { data, error } = await db().from("tickets").select("version").eq("id", ticketId).single();
  if (error) throw error;
  const rows = await rpc<{ attempt_id: number }[]>("request_customer_receipt", {
    p_ticket_id: ticketId,
    p_expected_version: data.version,
    p_employee_id: employeeId,
    p_client_key: crypto.randomUUID(),
    p_actor: null,
  });
  await rpc("record_print_outcome", { p_attempt_id: rows[0]!.attempt_id, p_printed: true, p_employee_id: employeeId, p_actor: null });
}

export async function cancelTicket(ticketId: number, employeeId: number) {
  const { data, error } = await db().from("tickets").select("version").eq("id", ticketId).single();
  if (error) throw error;
  await rpc("cancel_order", { p_ticket_id: ticketId, p_expected_version: data.version, p_employee_id: employeeId, p_actor: null });
}

/** Cancels whatever earlier runs left open at these tables, so each starts with a fresh order. */
export async function cancelOpenOrders(codes: string[]) {
  const staff = await employee("99", "Test cleanup", "waiter");
  for (const code of codes) {
    for (const ticket of await openTicketsAt(code)) {
      await rpc("cancel_order", { p_ticket_id: ticket.id, p_expected_version: ticket.version, p_employee_id: staff, p_actor: null });
    }
  }
}

export async function batchesOf(ticketId: number) {
  const { data, error } = await db()
    .from("ticket_batches")
    .select("id, batch_no, notes, employee_id, kitchen_printed_at, ticket_lines(item_name, quantity, unit_price_cents, tax_category_code, tax_group_code, is_custom, menu_item_id)")
    .eq("ticket_id", ticketId)
    .order("batch_no");
  if (error) throw error;
  return data;
}

export async function printAttempts(ticketId: number, kind: "customer" | "kitchen" = "customer") {
  const { data, error } = await db().from("print_attempts").select("attempt_no, kind, outcome").eq("ticket_id", ticketId).eq("receipt_kind", kind).order("id");
  if (error) throw error;
  return data;
}

export async function ticketTotal(number: number): Promise<number> {
  const { data, error } = await db().from("ticket_totals").select("total_cents").eq("ticket_number", number).single();
  if (error) throw error;
  return data.total_cents as number;
}

export async function visitCleared(visitId: number): Promise<boolean> {
  return (await visitRow(visitId)).cleared_at !== null;
}

export async function currentRotation(): Promise<string[]> {
  const rows = await rpc<{ section_code: string; section_position: number }[]>("current_rotation", {});
  return rows.sort((a, b) => a.section_position - b.section_position).map((row) => row.section_code);
}

export async function setTaxRate(group: "food" | "liquor", rateBp: number): Promise<void> {
  const { error } = await db().from("tax_groups").update({ rate_bp: rateBp }).eq("code", group);
  if (error) throw error;
}
