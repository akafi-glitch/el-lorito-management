"use server";

import { redirect } from "next/navigation";

import { requireActiveUser } from "@/features/auth/session";

import { findEmployeeByNumber } from "./queries";
import { lookupResult, waiterPath } from "./rules";
import { employeeNumberSchema } from "./schema";

export type FindWaiterState = { message: string | null };

/**
 * Number pad submit: looks the number up and opens that waiter's tables. Employee numbers say who
 * is working; the signed-in account is what protects the app.
 */
export async function findWaiterAction(_previous: FindWaiterState, formData: FormData): Promise<FindWaiterState> {
  await requireActiveUser();
  const parsed = employeeNumberSchema.safeParse(formData.get("employeeNumber") ?? "");
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Enter your employee number." };

  let employee;
  try {
    employee = await findEmployeeByNumber(parsed.data);
  } catch {
    return { message: "Couldn't look up the number. Check the connection and try again." };
  }

  const result = lookupResult(parsed.data, employee);
  if (!result.ok) return { message: result.message };
  redirect(waiterPath(result.employee));
}
