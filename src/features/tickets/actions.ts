"use server";

import { z } from "zod";

import { requireActiveUser } from "@/features/auth/session";
import { findEmployeeByNumber } from "@/features/waiter/queries";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import { shouldReload, ticketErrorMessage } from "./errors";
import {
  cancelTicketSchema,
  changeTicketSchema,
  saveOrderSchema,
  type CancelTicketInput,
  type ChangeTicketInput,
  type SaveOrderInput,
} from "./schema";

/**
 * Order and ticket actions. Each checks the signed-in account and the waiter's number, validates the
 * input, and calls ONE database function. The database sets menu prices (including the 3 PM lunch
 * amount) and refuses stale, finalized, or cancelled changes. Orders belong to a table: seating doesn't matter. The screen reloads its
 * data in the background afterwards, so the answer comes back at once.
 */

export type SaveOrderResult =
  | { ok: true; message: string; ticketId: number; ticketNumber: number; version: number; batchId: number; batchNo: number }
  | { ok: false; message: string; reload: boolean };

export type ChangeTicketResult = { ok: true; message: string; version: number } | { ok: false; message: string; reload: boolean };

const savedRows = z
  .array(
    z.object({
      ticket_id: z.number().int().positive(),
      ticket_number: z.number().int().positive(),
      version: z.number().int().positive(),
      batch_id: z.number().int().positive(),
      batch_no: z.number().int().positive(),
      already_saved: z.boolean(),
    }),
  )
  .length(1);

async function activeEmployeeId(employeeNumber: string): Promise<{ id: number } | { message: string }> {
  const employee = await findEmployeeByNumber(employeeNumber);
  if (!employee) return { message: "Your employee number wasn't found. Enter it again." };
  if (!employee.isActive) return { message: `${employee.name} is turned off and can't save tickets. Ask a manager.` };
  return { id: employee.id };
}

export async function saveOrderAction(input: SaveOrderInput): Promise<SaveOrderResult> {
  const user = await requireActiveUser();
  const parsed = saveOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the order.", reload: false };

  const { employeeNumber, tableCode, clientKey, lines, notes } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("save_table_order", {
    p_table_code: tableCode,
    p_employee_id: employee.id,
    p_client_key: clientKey,
    p_lines: lines.map((line) =>
      "itemId" in line
        ? { item_id: line.itemId, quantity: line.quantity }
        : { name: line.name, price_cents: line.priceCents, tax_category: line.taxCategory, quantity: line.quantity },
    ),
    p_notes: notes,
    p_time_zone: serverEnv().APP_TIME_ZONE,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: ticketErrorMessage(error), reload: shouldReload(error) };

  const saved = savedRows.safeParse(data);
  if (!saved.success) return { ok: false, message: "The order was saved but couldn't be shown. Refresh the page.", reload: true };
  const row = saved.data[0]!;
  return {
    ok: true,
    message: `Order saved on ticket #${row.ticket_number}.`,
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    version: row.version,
    batchId: row.batch_id,
    batchNo: row.batch_no,
  };
}

export async function changeTicketAction(input: ChangeTicketInput): Promise<ChangeTicketResult> {
  const user = await requireActiveUser();
  const parsed = changeTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the change.", reload: false };

  const { employeeNumber, ticketId, version, changes } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("change_ticket", {
    p_ticket_id: ticketId,
    p_expected_version: version,
    p_employee_id: employee.id,
    p_changes: changes.map((change) =>
      change.op === "quantity"
        ? { op: "quantity", line_id: change.lineId, quantity: change.quantity }
        : change.op === "remove"
          ? { op: "remove", line_id: change.lineId }
          : { op: "notes", batch_id: change.batchId, notes: change.notes },
    ),
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: ticketErrorMessage(error), reload: shouldReload(error) };
  return { ok: true, message: "Saved.", version: Number(data) };
}

export async function cancelTicketAction(input: CancelTicketInput): Promise<ChangeTicketResult> {
  const user = await requireActiveUser();
  const parsed = cancelTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the ticket and try again.", reload: false };

  const { employeeNumber, ticketId, version } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("cancel_order", {
    p_ticket_id: ticketId,
    p_expected_version: version,
    p_employee_id: employee.id,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: ticketErrorMessage(error), reload: shouldReload(error) };
  const number = z.number().int().positive().safeParse(data);
  return { ok: true, message: number.success ? `Ticket #${number.data} cancelled.` : "Ticket cancelled.", version: version + 1 };
}
