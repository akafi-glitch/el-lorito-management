import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";

import { getSessionState } from "@/features/auth/session";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import { cookieSigningKey, signToken, tokenHash, verifySignedToken } from "./cookie";
import { SESSION_LIMIT_SECONDS } from "./rules";

const COOKIE_NAME = "el_lorito_pin";

export type PinSession = { employeeNumber: string; name: string; expiresAtMs: number };

const sessionRows = z.array(z.object({ employee_number: z.string(), full_name: z.string(), expires_at: z.string() }));

function signingKey(): Buffer {
  return cookieSigningKey(serverEnv().SUPABASE_SECRET_KEY);
}

/** The hash of this browser's session token, when its cookie is genuine. */
async function cookieTokenHash(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  const token = value ? verifySignedToken(value, signingKey()) : null;
  return token ? tokenHash(token) : null;
}

/**
 * The manager who unlocked Order History and the Shift Report in this browser, or null. Only for the
 * account that unlocked them. Reading it never extends the session: see touchPinSession.
 */
export const getPinSession = cache(async (): Promise<PinSession | null> => {
  const session = await getSessionState();
  if (session.status !== "signed-in") return null;
  const hash = await cookieTokenHash();
  if (!hash) return null;

  const { data, error } = await createAdminClient().rpc("pin_session_check", { p_token_hash: hash, p_user_id: session.user.userId });
  if (error) throw new Error(`Could not check the PIN session: ${error.message}`);
  const row = sessionRows.parse(data)[0];
  return row ? { employeeNumber: row.employee_number, name: row.full_name, expiresAtMs: Date.parse(row.expires_at) } : null;
});

/** For every query that returns order history or shift report data: no session, no data. */
export async function requirePinSession(): Promise<PinSession> {
  const session = await getPinSession();
  if (!session) throw new Error("A PIN session is required for this data.");
  return session;
}

/** Someone is really using the screen. False when the session has ended. */
export async function touchPinSession(userId: string): Promise<boolean> {
  const hash = await cookieTokenHash();
  if (!hash) return false;
  const { data, error } = await createAdminClient().rpc("pin_session_touch", { p_token_hash: hash, p_user_id: userId });
  if (error) throw new Error(`Could not update the PIN session: ${error.message}`);
  return data === true;
}

/** Puts the session's token in a cookie that scripts can't read. */
export async function setPinCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE_NAME, signToken(token, signingKey()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_LIMIT_SECONDS,
  });
}

/** Ends this browser's session, if it has one, and removes the cookie. */
export async function endPinSession(userId: string, reason: "lock" | "sign_out"): Promise<void> {
  const hash = await cookieTokenHash();
  (await cookies()).delete(COOKIE_NAME);
  if (!hash) return;
  const { error } = await createAdminClient().rpc("pin_session_end", { p_token_hash: hash, p_user_id: userId, p_reason: reason });
  if (error) throw new Error(`Could not end the PIN session: ${error.message}`);
}
