import "server-only";

import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { employeeNumberSchema } from "@/features/waiter/schema";
import { createAdminClient } from "@/lib/supabase/admin";

import { INCORRECT_PIN_TEXT, isPinFormat, LOCKED_OUT_TEXT, PIN_HASH_COST } from "./rules";

const reserved = z.array(z.object({ allowed: z.boolean(), employee_id: z.number().nullable(), pin_hash: z.string().nullable() })).length(1);

// Compared when a number has no PIN, so an answer takes as long whether or not the employee exists.
let dummyHash: Promise<string> | undefined;
function dummy(): Promise<string> {
  dummyHash ??= hash(randomBytes(16).toString("hex"), PIN_HASH_COST);
  return dummyHash;
}

/**
 * Compares a manager's PIN, here on the server. Tries are counted in the database, not in the browser, and the
 * PIN screen and approvals share them. A wrong PIN is recorded. A right one still has to be recorded by the caller.
 */
export async function checkManagerPin(typedNumber: unknown, typedPin: unknown, userId: string): Promise<{ ok: true; number: string } | { ok: false; message: string }> {
  const number = employeeNumberSchema.safeParse(typedNumber ?? "");
  const pin = String(typedPin ?? "");
  if (!number.success || !isPinFormat(pin)) return { ok: false, message: INCORRECT_PIN_TEXT };

  const db = createAdminClient();
  const { data, error } = await db.rpc("pin_reserve_attempt", { p_number: number.data });
  if (error) throw error;
  const attempt = reserved.parse(data)[0]!;
  if (!attempt.allowed) return { ok: false, message: LOCKED_OUT_TEXT };

  const matched = await compare(pin, attempt.pin_hash ?? (await dummy()));
  if (matched && attempt.pin_hash !== null) return { ok: true, number: number.data };

  const failed = await db.rpc("pin_login_failed", { p_number: number.data, p_user_id: userId });
  if (failed.error) throw failed.error;
  return { ok: false, message: failed.data === true ? LOCKED_OUT_TEXT : INCORRECT_PIN_TEXT };
}
