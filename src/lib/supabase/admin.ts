import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Full-access client using the SECRET key. Server only: the `server-only` import makes the build
 * fail if any browser component imports this file. Bypasses Row Level Security, so every caller
 * must validate input and check the signed-in user first. It holds no per-user state, so one client
 * serves every request instead of building a new one for each read.
 */
export function createAdminClient(): SupabaseClient {
  if (client) return client;
  const env = serverEnv();
  client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
