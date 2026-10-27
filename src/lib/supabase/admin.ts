import "server-only";

import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

/**
 * Full-access client using the SECRET key. Server only: the `server-only` import makes the build
 * fail if any browser component imports this file. Bypasses Row Level Security, so every caller
 * must validate input and check the signed-in user first.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
