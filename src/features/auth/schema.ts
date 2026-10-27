import { z } from "zod";

import { isValidUsername, normalizeUsername, USERNAME_RULE_TEXT } from "./username";

export const signInSchema = z.object({
  username: z
    .string()
    .transform(normalizeUsername)
    .refine(isValidUsername, { message: `Enter a valid username. ${USERNAME_RULE_TEXT}` }),
  // Length rules are enforced when an account is created. Sign-in only needs a non-empty value.
  password: z.string().min(1, "Enter your password.").max(200, "Password is too long."),
  next: z.string().optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;
