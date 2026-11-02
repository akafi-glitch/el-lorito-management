"use server";

import { requireActiveUser } from "@/features/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

import { seatingErrorMessage, shouldRefresh, undoErrorMessage } from "./errors";
import {
  sectionOpenSchema,
  seatPartySchema,
  visitChangeSchema,
  type SeatPartyInput,
  type SectionOpenInput,
  type VisitChangeInput,
} from "./schema";

/**
 * Floor actions. Each one: checks the signed-in account, validates input, calls ONE database
 * function (one transaction), and answers. The database makes the final decision (free table, open
 * section, current version), so two devices can never double-seat. The actions don't re-render the
 * floor: the screen has already shown the change and refreshes itself in the background, so the
 * answer comes back at once.
 */

export type FloorActionResult =
  | { ok: true; message: string; visitId: number; version: number }
  | { ok: false; message: string; refresh: boolean };

type RpcError = { code?: string | null; message?: string | null; details?: string | null };

function fail(error: RpcError, message = seatingErrorMessage(error)): FloorActionResult {
  return { ok: false, message, refresh: shouldRefresh(error) };
}

function firstIssue(issues: { message: string }[]): FloorActionResult {
  return { ok: false, message: issues[0]?.message ?? "Check the details and try again.", refresh: false };
}

export async function seatPartyAction(input: SeatPartyInput): Promise<FloorActionResult> {
  const user = await requireActiveUser();
  const parsed = seatPartySchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { tableCodes, guestCount, combinationCode } = parsed.data;
  const { data, error } = await createAdminClient().rpc("seat_party", {
    p_table_codes: tableCodes,
    p_guest_count: guestCount,
    p_actor: user.userId,
    p_combination_code: combinationCode,
  });
  if (error) return fail(error);

  const guests = guestCount === 1 ? "1 guest" : `${guestCount} guests`;
  return { ok: true, message: `Seated ${guests} at ${tableCodes.join(" + ")}.`, visitId: Number(data), version: 1 };
}

export async function markChipsServedAction(input: VisitChangeInput): Promise<FloorActionResult> {
  const user = await requireActiveUser();
  const parsed = visitChangeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { data, error } = await createAdminClient().rpc("mark_chips_served", {
    p_visit_id: parsed.data.visitId,
    p_expected_version: parsed.data.version,
    p_actor: user.userId,
  });
  if (error) return fail(error);
  return { ok: true, message: "Chips served.", visitId: parsed.data.visitId, version: Number(data) };
}

export async function undoChipsServedAction(input: VisitChangeInput): Promise<FloorActionResult> {
  const user = await requireActiveUser();
  const parsed = visitChangeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { data, error } = await createAdminClient().rpc("undo_chips_served", {
    p_visit_id: parsed.data.visitId,
    p_expected_version: parsed.data.version,
    p_actor: user.userId,
  });
  if (error) return fail(error, undoErrorMessage(error));
  return { ok: true, message: "Undone: the table needs chips again.", visitId: parsed.data.visitId, version: Number(data) };
}

export async function clearTableAction(input: VisitChangeInput): Promise<FloorActionResult> {
  const user = await requireActiveUser();
  const parsed = visitChangeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { data, error } = await createAdminClient().rpc("clear_visit", {
    p_visit_id: parsed.data.visitId,
    p_expected_version: parsed.data.version,
    p_actor: user.userId,
  });
  if (error) return fail(error);
  return { ok: true, message: "Table cleared.", visitId: parsed.data.visitId, version: Number(data) };
}

export async function setSectionOpenAction(input: SectionOpenInput): Promise<FloorActionResult> {
  const user = await requireActiveUser();
  const parsed = sectionOpenSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { error } = await createAdminClient().rpc("set_section_open", {
    p_section_code: parsed.data.sectionCode,
    p_is_open: parsed.data.isOpen,
    p_actor: user.userId,
  });
  if (error) return fail(error);
  return { ok: true, message: parsed.data.isOpen ? "Section opened." : "Section closed.", visitId: 0, version: 0 };
}
