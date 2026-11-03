import "server-only";

import { redirect } from "next/navigation";

import { findEmployeeByNumber, restaurantIsOpen } from "./queries";
import { lookupResult, type LookupResult } from "./rules";
import { employeeNumberSchema } from "./schema";

/**
 * Reads the employee number from a link (/waiter/01) and checks it the same way the number pad does.
 * While the restaurant is closed it goes back to the Waiter Section, which says so.
 */
export async function resolveWaiter(rawParam: string): Promise<LookupResult> {
  let typed: string;
  try {
    typed = decodeURIComponent(rawParam);
  } catch {
    typed = rawParam;
  }
  const parsed = employeeNumberSchema.safeParse(typed);
  if (!parsed.success) return { ok: false, message: "That isn't an employee number. Enter your number again." };
  const [open, employee] = await Promise.all([restaurantIsOpen(), findEmployeeByNumber(parsed.data)]);
  if (!open) redirect("/waiter");
  return lookupResult(parsed.data, employee);
}
