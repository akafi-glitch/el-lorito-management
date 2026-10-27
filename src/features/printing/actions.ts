"use server";

import { requireActiveUser } from "@/features/auth/session";
import { findEmployeeByNumber } from "@/features/waiter/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

import { printErrorMessage } from "./errors";
import { loadReceipt } from "./queries";
import type { ReceiptData } from "./receipt";
import {
  printOutcomeSchema,
  printTicketSchema,
  reprintTicketSchema,
  type PrintOutcomeInput,
  type PrintTicketInput,
  type ReprintTicketInput,
} from "./schema";

/**
 * Printing actions. The database records the print (and, the first time, locks the ticket and
 * freezes its totals) BEFORE the browser's print dialog opens; the receipt is then built from what
 * the database stored. These actions don't refresh the page themselves, so the "Did it print?"
 * question stays on screen; the screen refreshes when the waiter is done.
 */

export type PrintResult = { ok: true; attemptId: number; receipt: ReceiptData } | { ok: false; message: string };
export type OutcomeResult = { ok: true; message: string } | { ok: false; message: string };

const attemptId = z.number().int().positive();

async function activeEmployeeId(employeeNumber: string): Promise<{ id: number } | { message: string }> {
  const employee = await findEmployeeByNumber(employeeNumber);
  if (!employee) return { message: "Your employee number wasn't found. Enter it again." };
  if (!employee.isActive) return { message: `${employee.name} is turned off and can't print. Ask a manager.` };
  return { id: employee.id };
}

async function receiptFor(ticketId: number, id: unknown): Promise<PrintResult> {
  const parsed = attemptId.safeParse(id);
  if (!parsed.success) return { ok: false, message: "The print was recorded but couldn't be shown. Refresh the page." };
  return { ok: true, attemptId: parsed.data, receipt: await loadReceipt(ticketId) };
}

export async function printTicketAction(input: PrintTicketInput): Promise<PrintResult> {
  const user = await requireActiveUser();
  const parsed = printTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the ticket and try again." };
  const { employeeNumber, visitId, ticketId, version } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message };

  const { data, error } = await createAdminClient().rpc("print_ticket", {
    p_visit_id: visitId,
    p_ticket_id: ticketId,
    p_expected_version: version,
    p_employee_id: employee.id,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: printErrorMessage(error) };
  return receiptFor(ticketId, data);
}

export async function reprintTicketAction(input: ReprintTicketInput): Promise<PrintResult> {
  const user = await requireActiveUser();
  const parsed = reprintTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the ticket and try again." };
  const { employeeNumber, ticketId } = parsed.data;
  const employee = await activeEmployeeId(employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message };

  const { data, error } = await createAdminClient().rpc("reprint_ticket", {
    p_ticket_id: ticketId,
    p_employee_id: employee.id,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: printErrorMessage(error) };
  return receiptFor(ticketId, data);
}

export async function recordPrintOutcomeAction(input: PrintOutcomeInput): Promise<OutcomeResult> {
  const user = await requireActiveUser();
  const parsed = printOutcomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Answer Yes or No." };
  const employee = await activeEmployeeId(parsed.data.employeeNumber);
  if ("message" in employee) return { ok: false, message: employee.message };

  const { error } = await createAdminClient().rpc("record_print_outcome", {
    p_attempt_id: parsed.data.attemptId,
    p_printed: parsed.data.printed,
    p_employee_id: employee.id,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: printErrorMessage(error) };
  return { ok: true, message: parsed.data.printed ? "Printed." : "Noted: it didn't print." };
}
