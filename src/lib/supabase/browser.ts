"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/public-env";

/**
 * Browser client with the low-privilege publishable key.
 * Used only to listen for live "something changed" signals (Phase 10). It never reads or writes data.
 */
export function createBrowserSupabaseClient() {
  const env = publicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
