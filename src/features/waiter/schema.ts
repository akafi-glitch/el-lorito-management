import { z } from "zod";

import { EMPLOYEE_NUMBER_MAX_DIGITS } from "./rules";

/** What a waiter types on the number pad. */
export const employeeNumberSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Enter your employee number.")
      .regex(new RegExp(`^[0-9]{1,${EMPLOYEE_NUMBER_MAX_DIGITS}}$`), "Employee numbers are digits only, for example 01."),
  );

/** Table codes in links, such as A3, X10 or BAR-2. */
export const tableCodeSchema = z.string().regex(/^[A-Z0-9-]{1,12}$/);
