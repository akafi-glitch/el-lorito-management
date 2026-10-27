/**
 * Runs after `next build`. Fails the build if anything that reaches a browser contains a
 * Supabase secret key: anything shaped like one (`sb_secret_` followed by key characters), or the
 * actual SUPABASE_SECRET_KEY value. The bare words "sb_secret_" may appear in code that checks
 * key types (ours and supabase-js's); a real key never may.
 * Checks browser JavaScript (.next/static) and pre-rendered HTML (.next/server/app).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [".next/static", ".next/server/app"];
const browserFile = /\.(js|mjs|css|html|json|txt|rsc|body)$/;

function loadSecretFromEnvFile() {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^SUPABASE_SECRET_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

if (!existsSync(".next/static")) {
  console.error("check-no-secrets: .next/static not found. Run `next build` first.");
  process.exit(1);
}

const secret = loadSecretFromEnvFile();
const needles = [];
if (secret && !secret.includes("replace_me") && secret.length >= 12) needles.push(secret);
/** sb_secret_ plus at least 16 key characters: a key, not a prefix check in code. */
const keyShape = /sb_secret_[A-Za-z0-9_-]{16,}/;

const leaks = [];
let scanned = 0;
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    if (!browserFile.test(file)) continue;
    scanned += 1;
    const content = readFileSync(file, "utf8");
    if (keyShape.test(content) || needles.some((needle) => content.includes(needle))) leaks.push(file);
  }
}

if (leaks.length > 0) {
  console.error("✗ Secret key material found in browser-facing build files:");
  for (const file of leaks) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`✓ No secret keys in ${scanned} browser-facing build files.`);
