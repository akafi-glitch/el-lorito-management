import { z } from "zod";

import { isValidUsername, normalizeUsername, PASSWORD_MIN_LENGTH, USERNAME_RULE_TEXT } from "@/features/auth/username";

import { DUTIES, ROLES } from "./rules";

const name = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "Enter a name.").max(80, "Use 80 characters or fewer."));

export const addEmployeeSchema = z.object({
  number: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().regex(/^[0-9]{1,6}$/, "Employee numbers are 1 to 6 digits, for example 01.")),
  name,
  role: z.enum(ROLES, { message: "Choose a role." }),
});

export const updateEmployeeSchema = z.object({
  id: z.number().int().positive(),
  name,
  role: z.enum(ROLES, { message: "Choose a role." }),
  isActive: z.boolean(),
});

export const assignDutySchema = z.object({
  sectionCode: z.string().regex(/^[A-Z0-9-]{1,8}$/),
  duty: z.enum(DUTIES),
  employeeId: z.number().int().positive().nullable(),
});

// Supabase Auth hashes passwords with bcrypt, which reads at most 72 bytes.
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, "Use 72 characters or fewer.");

export const addAccountSchema = z
  .object({
    username: z
      .string()
      .transform(normalizeUsername)
      .refine(isValidUsername, { message: `Username: ${USERNAME_RULE_TEXT}` }),
    displayName: name,
    password,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { message: "The two passwords don't match.", path: ["confirm"] });

export const setPasswordSchema = z
  .object({ userId: z.guid(), password, confirm: z.string() })
  .refine((value) => value.password === value.confirm, { message: "The two passwords don't match.", path: ["confirm"] });

export const accountActiveSchema = z.object({ userId: z.guid(), isActive: z.boolean() });

export type AddEmployeeInput = z.input<typeof addEmployeeSchema>;
export type UpdateEmployeeInput = z.input<typeof updateEmployeeSchema>;
export type AssignDutyInput = z.input<typeof assignDutySchema>;
export type AddAccountInput = z.input<typeof addAccountSchema>;
export type SetPasswordInput = z.input<typeof setPasswordSchema>;
export type AccountActiveInput = z.input<typeof accountActiveSchema>;
