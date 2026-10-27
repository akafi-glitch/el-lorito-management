/**
 * CI helper: turns `supabase status -o json` (a local Supabase started in the CI machine) into the
 * app's .env.local. Prints only variable names to the log, never values.
 *
 *   supabase status -o json > /tmp/status.json && node scripts/ci-env.mjs /tmp/status.json > .env.local
 */
import { readFileSync } from "node:fs";

const status = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pick = (...names) => {
  for (const name of names) {
    const value = status[name] ?? status[name.toLowerCase()];
    if (typeof value === "string" && value) return { name, value };
  }
  throw new Error(`supabase status has none of: ${names.join(", ")} (has: ${Object.keys(status).join(", ")})`);
};

const url = pick("API_URL");
const publishable = pick("PUBLISHABLE_KEY", "ANON_KEY");
const secret = pick("SECRET_KEY", "SERVICE_ROLE_KEY");
console.error(`Using ${url.name}, ${publishable.name}, ${secret.name} from the local Supabase.`);

process.stdout.write(
  [
    `NEXT_PUBLIC_SUPABASE_URL=${url.value}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable.value}`,
    `SUPABASE_SECRET_KEY=${secret.value}`,
    "APP_TIME_ZONE=America/Chicago",
    "",
  ].join("\n"),
);
