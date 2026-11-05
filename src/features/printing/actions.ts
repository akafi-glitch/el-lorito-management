"use server";

import { requireActiveUser } from "@/features/auth/session";
import { findEmployeeByNumber } from "@/features/waiter/queries";
import { createAdminClient } from "@/lib/supabase/admin";

import { printErrorMessage } from "./errors";
import { formatReceiptTime, loadKitchenReceipts } from "./queries";
import { receiptFromSnapshot, type KitchenReceiptData, type ReceiptData } from "./receipt";
import {
  customerAttemptRowsSchema,
  kitchenAttemptRowsSchema,
  printCustomerSchema,
  printKitchenSchema,
  printOutcomeSchema,
  type PrintCustomerInput,
  type PrintKitchenInput,
  type PrintOutcomeInput,
} from "./schema";

/**
 * Printing actions. The database records every print BEFORE the browser's print dialog opens, and
 * nothing is finalized by opening a dialog: only the waiter's "Yes, it printed" for a customer
 * receipt finalizes the ticket, in the database, in one transaction. These actions don't refresh the
 * page themselves, so the receipt and the question stay on screen until the waiter is done.
 */

export type KitchenPrintResult =
  | { ok: true; attemptIds: number[]; batchIds: number[]; receipts: KitchenReceiptData[] }
  | { ok: false; message: string; reload: boolean };
export type CustomerPrintResult =
  | { ok: true; attemptId: number; receipt: ReceiptData; isCopy: boolean }
  | { ok: false; message: string; reload: boolean };
export type OutcomeResult = { ok: true; message: string } | { ok: false; message: string };

const RELOAD = ["stale_ticket", "ticket_finalized", "ticket_printed", "ticket_cancelled", "visit_closed", "nothing_to_print", "empty_batch", "batch_not_found"];

async function activeEmployeeId(employeeNumber: string): Promise<{ id: number } | { message: string }> {
  const employee = await findEmployeeByNumber(employeeNumber);
  if (!employee) return { message: "Your employee number wasn't found. Enter it again." };
  if (!employee.isActive) return { message: `${employee.name} is turned off and can't print. Ask a manager.` };
  return { id: employee.id };
}

export async function printKitchenAction(input: PrintKitchenInput): Promise<KitchenPrintResult> {
  const user = await requireActiveUser();
  const parsed = printKitchenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the order and try again.", reload: false };
  const { employeeNumber, ticketId, batchIds, clientKey } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("request_kitchen_print", {
    p_ticket_id: ticketId,
    p_batch_ids: batchIds,
    p_employee_id: employee.id,
    p_client_key: clientKey,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: printErrorMessage(error), reload: RELOAD.includes(error.message) };

  const rows = kitchenAttemptRowsSchema.safeParse(data);
  if (!rows.success) return { ok: false, message: "The print was recorded but couldn't be shown. Refresh the page.", reload: true };
  return {
    ok: true,
    attemptIds: rows.data.map((row) => row.attempt_id),
    batchIds: rows.data.map((row) => row.batch_id),
    receipts: await loadKitchenReceipts(rows.data.map((row) => ({ batchId: row.batch_id, isReprint: row.is_reprint }))),
  };
}

export async function printCustomerAction(input: PrintCustomerInput): Promise<CustomerPrintResult> {
  const user = await requireActiveUser();
  const parsed = printCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the ticket and try again.", reload: false };
  const { employeeNumber, ticketId, version, clientKey } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message, reload: false };

  const { data, error } = await createAdminClient().rpc("request_customer_receipt", {
    p_ticket_id: ticketId,
    p_expected_version: version,
    p_employee_id: employee.id,
    p_client_key: clientKey,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: printErrorMessage(error), reload: RELOAD.includes(error.message) };

  const rows = customerAttemptRowsSchema.safeParse(data);
  if (!rows.success) return { ok: false, message: "The print was recorded but couldn't be shown. Refresh the page.", reload: true };
  const row = rows.data[0]!;
  return { ok: true, attemptId: row.attempt_id, receipt: receiptFromSnapshot(row.receipt, formatReceiptTime), isCopy: row.is_copy };
}

/** The waiter's answer. Yes to a customer receipt finalizes the ticket (see record_print_outcome). */
export async function recordPrintOutcomeAction(input: PrintOutcomeInput): Promise<OutcomeResult> {
  const user = await requireActiveUser();
  const parsed = printOutcomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Answer Yes or No." };
  const employee = await activeEmployeeId(parsed.data.employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message };

  for (const attemptId of parsed.data.attemptIds) {
    const { error } = await createAdminClient().rpc("record_print_outcome", {
      p_attempt_id: attemptId,
      p_printed: parsed.data.printed,
      p_employee_id: employee.id,
      p_actor: user.userId,
    });
    if (error) return { ok: false, message: printErrorMessage(error) };
  }
  return { ok: true, message: parsed.data.printed ? "Printed." : "Noted: it didn't print." };
}
