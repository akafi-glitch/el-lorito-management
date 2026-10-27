"use server";

import { redirect } from "next/navigation";

import { createSessionClient } from "@/lib/supabase/server";

import { safeNextPath } from "./redirect";
import { signInSchema } from "./schema";
import { findAppUser } from "./session";
import { usernameToEmail } from "./username";

export type SignInState = { error: string | null; username: string };

const WRONG_CREDENTIALS = "Username or password is wrong.";

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    username: formData.get("username") ?? "",
    password: formData.get("password") ?? "",
    next: formData.get("next") ?? undefined,
  });
  const typedUsername = String(formData.get("username") ?? "");

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? WRONG_CREDENTIALS, username: typedUsername };
  }

  const { username, password, next } = parsed.data;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error || !data.user) {
    const tooMany = error?.status === 429;
    return {
      error: tooMany ? "Too many sign-in attempts. Wait a minute, then try again." : WRONG_CREDENTIALS,
      username,
    };
  }

  const appUser = await findAppUser(data.user.id);
  if (!appUser?.isActive) {
    await supabase.auth.signOut();
    return { error: "This account is turned off. Ask an administrator to turn it back on.", username };
  }

  redirect(safeNextPath(next));
}

export async function signOut(): Promise<never> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
