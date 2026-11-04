"use server";

import { redirect } from "next/navigation";

import { requireActiveUser } from "@/features/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

import { newSessionToken, tokenHash } from "./cookie";
import { endPinSession, setPinCookie, touchPinSession } from "./session";
import { checkManagerPin } from "./verify";

export type PinLoginState = { message: string | null };

/** The PIN screen: a right PIN opens a session in this browser. */
export async function pinLoginAction(_previous: PinLoginState, formData: FormData): Promise<PinLoginState> {
  const user = await requireActiveUser();
  try {
    const checked = await checkManagerPin(formData.get("employeeNumber"), formData.get("pin"), user.userId);
    if (!checked.ok) return { message: checked.message };

    const token = newSessionToken();
    const opened = await createAdminClient().rpc("pin_login_success", { p_number: checked.number, p_token_hash: tokenHash(token), p_user_id: user.userId });
    if (opened.error) throw opened.error;
    await setPinCookie(token);
    return { message: null };
  } catch {
    return { message: "Couldn't check the PIN. Check the connection and try again." };
  }
}

/** Lock: ends the session at once and goes back to Home. */
export async function lockPinSessionAction(): Promise<never> {
  const user = await requireActiveUser();
  await endPinSession(user.userId, "lock");
  redirect("/");
}

/** Called when someone is really using a protected page. False when the session has ended. */
export async function touchPinSessionAction(): Promise<boolean> {
  const user = await requireActiveUser();
  return touchPinSession(user.userId);
}
