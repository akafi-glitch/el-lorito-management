"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/features/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

import { seatingErrorMessage, shouldRefresh } from "./errors";
import {
  sectionOpenSchema,
  seatPartySchema,
  visitChangeSchema,
  type ActionResult,
  type SeatPartyInput,
  type SectionOpenInput,
  type VisitChangeInput,
} from "./schema";

/**
 * Floor actions. Each one: checks the signed-in account, validates input, calls ONE database
 * function (one transaction), then refreshes the floor. The database makes the final decision
 * (free table, open section, current version), so two devices can never double-seat.
 */

type RpcError = { code?: string | null; message?: string | null; details?: string | null };

function fail(error: RpcError): ActionResult {
  if (shouldRefresh(error)) revalidatePath("/floor");
  return { ok: false, message: seatingErrorMessage(error) };
}

function firstIssue(issues: { message: string }[]): ActionResult {
  return { ok: false, message: issues[0]?.message ?? "Check the details and try again." };
}

export async function seatPartyAction(input: SeatPartyInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = seatPartySchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { tableCodes, guestCount, combinationCode } = parsed.data;
  const { error } = await createAdminClient().rpc("seat_party", {
    p_table_codes: tableCodes,
    p_guest_count: guestCount,
    p_actor: user.userId,
    p_combination_code: combinationCode,
  });
  if (error) return fail(error);

  revalidatePath("/floor");
  const guests = guestCount === 1 ? "1 guest" : `${guestCount} guests`;
  return { ok: true, message: `Seated ${guests} at ${tableCodes.join(" + ")}.` };
}

export async function markChipsServedAction(input: VisitChangeInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = visitChangeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { error } = await createAdminClient().rpc("mark_chips_served", {
    p_visit_id: parsed.data.visitId,
    p_expected_version: parsed.data.version,
    p_actor: user.userId,
  });
  if (error) return fail(error);

  revalidatePath("/floor");
  return { ok: true, message: "Chips served." };
}

export async function clearTableAction(input: VisitChangeInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = visitChangeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { error } = await createAdminClient().rpc("clear_visit", {
    p_visit_id: parsed.data.visitId,
    p_expected_version: parsed.data.version,
    p_actor: user.userId,
  });
  if (error) return fail(error);

  revalidatePath("/floor");
  return { ok: true, message: "Table cleared." };
}

export async function setSectionOpenAction(input: SectionOpenInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = sectionOpenSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { error } = await createAdminClient().rpc("set_section_open", {
    p_section_code: parsed.data.sectionCode,
    p_is_open: parsed.data.isOpen,
    p_actor: user.userId,
  });
  if (error) return fail(error);

  revalidatePath("/floor");
  return { ok: true, message: parsed.data.isOpen ? "Section opened." : "Section closed." };
}
