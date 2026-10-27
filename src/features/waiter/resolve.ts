import "server-only";

import { findEmployeeByNumber } from "./queries";
import { lookupResult, type LookupResult } from "./rules";
import { employeeNumberSchema } from "./schema";

/** Reads the employee number from a link (/waiter/01) and checks it the same way the number pad does. */
export async function resolveWaiter(rawParam: string): Promise<LookupResult> {
  let typed: string;
  try {
    typed = decodeURIComponent(rawParam);
  } catch {
    typed = rawParam;
  }
  const parsed = employeeNumberSchema.safeParse(typed);
  if (!parsed.success) return { ok: false, message: "That isn't an employee number. Enter your number again." };
  return lookupResult(parsed.data, await findEmployeeByNumber(parsed.data));
}
