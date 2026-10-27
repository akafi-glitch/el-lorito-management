import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";

export type AppUser = {
  userId: string;
  username: string;
  displayName: string;
  isActive: boolean;
};

export type SessionState =
  | { status: "signed-out" }
  | { status: "inactive"; user: AppUser }
  | { status: "unknown-account" }
  | { status: "signed-in"; user: AppUser };

/**
 * Reads the signed-in administrator for this request. `getClaims` verifies the session token;
 * the app_users row decides whether the account may use the app. Cached per request.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return { status: "signed-out" };

  const user = await findAppUser(userId);
  if (!user) return { status: "unknown-account" };
  if (!user.isActive) return { status: "inactive", user };
  return { status: "signed-in", user };
});

export async function findAppUser(userId: string): Promise<AppUser | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_users")
    .select("user_id, username, display_name, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the signed-in account: ${error.message}`);
  if (!data) return null;
  return {
    userId: data.user_id,
    username: data.username,
    displayName: data.display_name,
    isActive: data.is_active,
  };
}
