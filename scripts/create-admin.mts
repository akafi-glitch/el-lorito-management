/**
 * Creates an administrator account. Run on your own computer:
 *
 *   npm run admin:create
 *
 * It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local, asks for a
 * username, display name and password (typed password is hidden), and creates the account.
 * Run it once per environment for the first administrator; later accounts come from the
 * Manage page. No password is ever written to a file.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit, env } from "node:process";
import { Writable } from "node:stream";

import { createClient } from "@supabase/supabase-js";

import {
  isValidUsername,
  normalizeUsername,
  PASSWORD_MIN_LENGTH,
  USERNAME_RULE_TEXT,
  usernameToEmail,
} from "../src/features/auth/username.ts";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
if (!secretKey.startsWith("sb_secret_")) fail("SUPABASE_SECRET_KEY must be a secret key (starts with sb_secret_).");

// A writable stream that can hide what is typed, for the password prompt.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: stdin, output, terminal: true });

async function askHidden(question: string): Promise<string> {
  stdout.write(question);
  muted = true;
  const answer = await rl.question("");
  muted = false;
  stdout.write("\n");
  return answer;
}

const username = normalizeUsername(await rl.question("Username: "));
if (!isValidUsername(username)) fail(`Invalid username. ${USERNAME_RULE_TEXT}`);

const displayName = (await rl.question("Display name (shown in the app): ")).trim();
if (displayName.length < 1 || displayName.length > 80) fail("Display name must be 1 to 80 characters.");

const password = await askHidden(`Password (at least ${PASSWORD_MIN_LENGTH} characters): `);
if (password.length < PASSWORD_MIN_LENGTH) fail(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
const confirm = await askHidden("Type the password again: ");
if (confirm !== password) fail("The two passwords don't match.");
rl.close();

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: usernameToEmail(username),
  password,
  email_confirm: true,
});
if (createError || !created.user) fail(`Could not create the sign-in account: ${createError?.message ?? "unknown error"}`);

const { error: insertError } = await admin
  .from("app_users")
  .insert({ user_id: created.user.id, username, display_name: displayName });

if (insertError) {
  // Undo the sign-in account so no half-made account is left behind.
  await admin.auth.admin.deleteUser(created.user.id);
  fail(`Could not save the account: ${insertError.message}`);
}

console.log(`\n✓ Administrator "${username}" created. Sign in at /sign-in with this username.`);
