"use server";

import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActiveUser } from "@/features/auth/session";
import { employeeNumberSchema } from "@/features/waiter/schema";
import { createAdminClient } from "@/lib/supabase/admin";

import { newSessionToken, tokenHash } from "./cookie";
import { INCORRECT_PIN_TEXT, isPinFormat, LOCKED_OUT_TEXT, PIN_HASH_COST } from "./rules";
import { endPinSession, setPinCookie, touchPinSession } from "./session";

export type PinLoginState = { message: string | null };

const reserved = z.array(z.object({ allowed: z.boolean(), employee_id: z.number().nullable(), pin_hash: z.string().nullable() })).length(1);

// Compared when a number has no PIN, so an answer takes as long whether or not the employee exists.
let dummyHash: Promise<string> | undefined;
function dummy(): Promise<string> {
  dummyHash ??= hash(randomBytes(16).toString("hex"), PIN_HASH_COST);
  return dummyHash;
}

/** The PIN is compared here, on the server. The tries are counted in the database, not in the browser. */
export async function pinLoginAction(_previous: PinLoginState, formData: FormData): Promise<PinLoginState> {
  const user = await requireActiveUser();
  const number = employeeNumberSchema.safeParse(formData.get("employeeNumber") ?? "");
  const pin = String(formData.get("pin") ?? "");
  if (!number.success || !isPinFormat(pin)) return { message: INCORRECT_PIN_TEXT };

  const db = createAdminClient();
  try {
    const { data, error } = await db.rpc("pin_reserve_attempt", { p_number: number.data });
    if (error) throw error;
    const attempt = reserved.parse(data)[0]!;
    if (!attempt.allowed) return { message: LOCKED_OUT_TEXT };

    const matched = await compare(pin, attempt.pin_hash ?? (await dummy()));
    if (!matched || attempt.pin_hash === null) {
      const failed = await db.rpc("pin_login_failed", { p_number: number.data, p_user_id: user.userId });
      if (failed.error) throw failed.error;
      return { message: failed.data === true ? LOCKED_OUT_TEXT : INCORRECT_PIN_TEXT };
    }

    const token = newSessionToken();
    const opened = await db.rpc("pin_login_success", { p_number: number.data, p_token_hash: tokenHash(token), p_user_id: user.userId });
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
