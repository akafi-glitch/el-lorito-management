import { z } from "zod";

/**
 * Rules for configuration values. Kept free of `server-only` so tests can import it.
 * The secret key must never be exposed through a NEXT_PUBLIC_ variable,
 * because Next.js copies every NEXT_PUBLIC_ value into browser code.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a full URL" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing")
    .refine((key) => !key.startsWith("sb_secret_"), {
      message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Use the publishable key here.",
    }),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, "SUPABASE_SECRET_KEY is missing")
    .refine((key) => !key.startsWith("sb_publishable_"), {
      message: "SUPABASE_SECRET_KEY holds the publishable key. Use the secret key here.",
    }),
  APP_TIME_ZONE: z
    .string()
    .default("America/Chicago")
    .refine(isValidTimeZone, { message: "APP_TIME_ZONE is not a valid time zone" }),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Fails if any NEXT_PUBLIC_ variable contains a secret key. */
function assertNoPublicSecrets(source: Record<string, string | undefined>): string[] {
  return Object.entries(source)
    .filter(([name, value]) => name.startsWith("NEXT_PUBLIC_") && value?.startsWith("sb_secret_"))
    .map(([name]) => `${name} contains a secret key. Secret keys must never use the NEXT_PUBLIC_ prefix.`);
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "EnvError";
  }
}

/** Every message names the variable, so a missing value is easy to find. */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.join(".");
    if (issue.code === "invalid_type") return `${name} is missing`;
    return issue.message.includes(name) ? issue.message : `${name}: ${issue.message}`;
  });
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const leaks = assertNoPublicSecrets(source);
  const result = publicSchema.safeParse(source);
  const problems = [...leaks, ...(result.success ? [] : formatIssues(result.error))];
  if (problems.length > 0 || !result.success) throw new EnvError(problems);
  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const leaks = assertNoPublicSecrets(source);
  const result = serverSchema.safeParse(source);
  const problems = [...leaks, ...(result.success ? [] : formatIssues(result.error))];
  if (problems.length > 0 || !result.success) throw new EnvError(problems);
  return result.data;
}
