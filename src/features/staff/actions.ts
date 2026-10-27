"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/features/auth/session";
import { usernameToEmail } from "@/features/auth/username";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";

import { accountErrorMessage, staffErrorMessage } from "./errors";
import { loadAccounts } from "./queries";
import { accountChangeProblem } from "./rules";
import {
  accountActiveSchema,
  addAccountSchema,
  addEmployeeSchema,
  assignDutySchema,
  setPasswordSchema,
  updateEmployeeSchema,
  type AccountActiveInput,
  type AddAccountInput,
  type AddEmployeeInput,
  type AssignDutyInput,
  type SetPasswordInput,
  type UpdateEmployeeInput,
} from "./schema";

/**
 * Management actions. Every one checks the signed-in account, validates input, and lets the
 * database (or Supabase Auth, for accounts) make the final decision.
 */

function firstIssue(issues: { message: string }[]): ActionResult {
  return { ok: false, message: issues[0]?.message ?? "Check the details and try again." };
}

function refreshStaffPages() {
  revalidatePath("/manage", "layout");
  revalidatePath("/floor");
}

export async function startShiftAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const { error } = await createAdminClient().rpc("start_shift", { p_actor: user.userId });
  if (error) return { ok: false, message: staffErrorMessage(error) };
  refreshStaffPages();
  return { ok: true, message: "New shift started. Assign waiters and chips runners." };
}

export async function assignDutyAction(input: AssignDutyInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = assignDutySchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { sectionCode, duty, employeeId } = parsed.data;
  const { error } = await createAdminClient().rpc("assign_duty", {
    p_section_code: sectionCode,
    p_duty: duty,
    p_employee_id: employeeId,
    p_actor: user.userId,
  });
  refreshStaffPages();
  if (error) return { ok: false, message: staffErrorMessage(error) };
  return { ok: true, message: employeeId === null ? "Assignment removed." : "Assignment saved." };
}

export async function addEmployeeAction(input: AddEmployeeInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = addEmployeeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { number, name, role } = parsed.data;
  const { error } = await createAdminClient().rpc("add_employee", {
    p_number: number,
    p_full_name: name,
    p_role: role,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: staffErrorMessage(error) };
  refreshStaffPages();
  return { ok: true, message: `${name} (${number}) added.` };
}

export async function updateEmployeeAction(input: UpdateEmployeeInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = updateEmployeeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { id, name, role, isActive } = parsed.data;
  const { error } = await createAdminClient().rpc("update_employee", {
    p_employee_id: id,
    p_full_name: name,
    p_role: role,
    p_is_active: isActive,
    p_actor: user.userId,
  });
  refreshStaffPages();
  if (error) return { ok: false, message: staffErrorMessage(error) };
  return { ok: true, message: `${name} saved.` };
}

async function recordAccountEvent(actor: string, type: "account_added" | "account_changed", details: object) {
  // History only; a failure here must not undo the account change, so it is logged, not thrown.
  const { error } = await createAdminClient().from("audit_events").insert({ actor_id: actor, event_type: type, details });
  if (error) console.error("Could not record account history:", error.message);
}

export async function addAccountAction(input: AddAccountInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = addAccountSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { username, displayName, password } = parsed.data;
  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
  });
  if (createError || !created.user) return { ok: false, message: accountErrorMessage(createError ?? {}) };

  const { error: insertError } = await admin
    .from("app_users")
    .insert({ user_id: created.user.id, username, display_name: displayName, created_by: user.userId });
  if (insertError) {
    // Undo the sign-in account so no half-made account is left behind.
    await admin.auth.admin.deleteUser(created.user.id);
    return {
      ok: false,
      message: insertError.code === "23505" ? "That username is already used." : "The account couldn't be saved. Try again.",
    };
  }

  await recordAccountEvent(user.userId, "account_added", { account: created.user.id, username });
  revalidatePath("/manage/accounts");
  return { ok: true, message: `Account "${username}" added. They can sign in now.` };
}

export async function setAccountActiveAction(input: AccountActiveInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = accountActiveSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const accounts = await loadAccounts();
  const target = accounts.find((account) => account.userId === parsed.data.userId);
  if (!target) return { ok: false, message: "That account no longer exists." };
  const problem = accountChangeProblem(target, parsed.data.isActive, user.userId, accounts);
  if (problem) return { ok: false, message: problem };

  const { error } = await createAdminClient()
    .from("app_users")
    .update({ is_active: parsed.data.isActive })
    .eq("user_id", target.userId);
  if (error) return { ok: false, message: "The account couldn't be saved. Try again." };

  await recordAccountEvent(user.userId, "account_changed", { account: target.userId, active: parsed.data.isActive });
  revalidatePath("/manage/accounts");
  return {
    ok: true,
    message: parsed.data.isActive ? `"${target.username}" can sign in again.` : `"${target.username}" is turned off.`,
  };
}

export async function setAccountPasswordAction(input: SetPasswordInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error.issues);

  const { error } = await createAdminClient().auth.admin.updateUserById(parsed.data.userId, {
    password: parsed.data.password,
  });
  if (error) return { ok: false, message: accountErrorMessage(error) };

  await recordAccountEvent(user.userId, "account_changed", { account: parsed.data.userId, password_changed: true });
  return { ok: true, message: "New password saved." };
}
