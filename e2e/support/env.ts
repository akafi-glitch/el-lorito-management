import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (in .env.local) for the end-to-end tests.`);
  return value;
}

/** Refuses to run against anything but a local Supabase, so the tests can never touch the live data. */
export function testEnv() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(`End-to-end tests only run against a local Supabase, not ${host}.`);
  }
  return {
    url,
    secretKey: required("SUPABASE_SECRET_KEY"),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    username: process.env.E2E_USERNAME ?? "e2e-admin",
    password: process.env.E2E_PASSWORD ?? "e2e-correct-horse-42",
    /** Set where Supabase Realtime runs (CI): the live connection itself is then tested. */
    realtime: process.env.E2E_REALTIME === "1",
  };
}
