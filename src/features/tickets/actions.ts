"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveUser } from "@/features/auth/session";
import { findEmployeeByNumber } from "@/features/waiter/queries";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import { shouldReload, ticketErrorMessage } from "./errors";
import { cancelTicketSchema, saveTicketSchema, type CancelTicketInput, type SaveTicketInput } from "./schema";

/**
 * Ticket actions. Each checks the signed-in account and the waiter's number, validates the order,
 * and calls ONE database function. The database sets the prices (including the 3 PM lunch amount)
 * and refuses stale, printed, cancelled, or closed-table changes.
 */

export type TicketActionResult =
  | { ok: true; message: string; ticketNumber: number; ticketId: number; version: number }
  | { ok: false; message: string; reload: boolean };

/** save_ticket returns one row: { ticket_id, ticket_number, version }. */
const savedRows = z
  .array(z.object({ ticket_id: z.number().int().positive(), ticket_number: z.number().int().positive(), version: z.number().int().positive() }))
  .length(1);

async function activeEmployeeId(employeeNumber: string): Promise<{ id: number } | { message: string }> {
  const employee = await findEmployeeByNumber(employeeNumber);
  if (!employee) return { message: "Your employee number wasn't found. Enter it again." };
  if (!employee.isActive) return { message: `${employee.name} is turned off and can't save tickets. Ask a manager.` };
  return { id: employee.id };
}

function refreshWaiterPages() {
  revalidatePath("/waiter", "layout");
}

export async function saveTicketAction(input: SaveTicketInput): Promise<TicketActionResult> {
  const user = await requireActiveUser();
  const parsed = saveTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the order.", reload: false };

  const { employeeNumber, visitId, ticketId, version, lines } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("save_ticket", {
    p_visit_id: visitId,
    p_ticket_id: ticketId,
    p_expected_version: version,
    p_employee_id: employee.id,
    p_lines: lines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
    p_time_zone: serverEnv().APP_TIME_ZONE,
    p_actor: user.userId,
  });
  if (error) {
    const reload = shouldReload(error);
    if (reload) refreshWaiterPages();
    return { ok: false, message: ticketErrorMessage(error), reload };
  }

  const saved = savedRows.safeParse(data);
  if (!saved.success) return { ok: false, message: "The ticket was saved but couldn't be shown. Refresh the page.", reload: true };
  const row = saved.data[0]!;
  refreshWaiterPages();
  return { ok: true, message: `Ticket #${row.ticket_number} saved.`, ticketNumber: row.ticket_number, ticketId: row.ticket_id, version: row.version };
}

export async function cancelTicketAction(input: CancelTicketInput): Promise<TicketActionResult> {
  const user = await requireActiveUser();
  const parsed = cancelTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the ticket and try again.", reload: false };

  const { employeeNumber, visitId, ticketId, version } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("cancel_ticket", {
    p_visit_id: visitId,
    p_ticket_id: ticketId,
    p_expected_version: version,
    p_employee_id: employee.id,
    p_actor: user.userId,
  });
  if (error) {
    const reload = shouldReload(error);
    if (reload) refreshWaiterPages();
    return { ok: false, message: ticketErrorMessage(error), reload };
  }
  refreshWaiterPages();
  const number = z.number().int().positive().safeParse(data);
  return {
    ok: true,
    message: number.success ? `Ticket #${number.data} cancelled.` : "Ticket cancelled.",
    ticketNumber: number.success ? number.data : 0,
    ticketId,
    version: version + 1,
  };
}
