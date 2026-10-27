import { parsePublicEnv, type PublicEnv } from "./env-schema";

let cached: PublicEnv | undefined;

/**
 * Browser-safe configuration. Next.js replaces these two variables at build time,
 * so they must be referenced by their full names here.
 */
export function publicEnv(): PublicEnv {
  cached ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cached;
}
