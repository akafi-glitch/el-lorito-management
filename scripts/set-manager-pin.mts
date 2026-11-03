/**
 * Sets, resets, or turns off a manager's PIN for Order History and the Shift Report. Run on your own computer:
 *
 *   npm run admin:pin              set or reset a PIN
 *   npm run admin:pin -- --disable turn a PIN off
 *
 * It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local, and changes the database those
 * name. The PIN is typed hidden, only its hash leaves this computer, and it is never written or shown anywhere.
 */
import { createInterface } from "node:readline/promises";
import { argv, env, exit, stdin, stdout } from "node:process";
import { Writable } from "node:stream";

import { createClient } from "@supabase/supabase-js";
import { hash } from "bcryptjs";

import { PIN_HASH_COST, pinProblem } from "../src/features/pin/rules.ts";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  exit(1);
}

const REFUSED: Record<string, string> = {
  employee_not_found: "No employee has that number.",
  employee_inactive: "That employee is turned off. Turn them on first.",
  not_a_manager: "Only a manager can have a PIN. Change their role under Management, then Employees, first.",
  no_pin: "That employee has no PIN turned on.",
};

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");

// A writable stream that can hide what is typed, for the PIN prompt.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) stdout.write(chunk, encoding);
    callback();
  },
});
const prompt = createInterface({ input: stdin, output, terminal: stdin.isTTY });

// Lines are kept until asked for, so nothing is lost between one question and the next.
const lines: string[] = [];
let waiting: ((line: string | null) => void) | null = null;
let closed = false;
function answer(line: string | null) {
  const resolve = waiting;
  waiting = null;
  resolve?.(line);
}
prompt.on("line", (line) => {
  if (waiting) answer(line);
  else lines.push(line);
});
prompt.on("close", () => {
  closed = true;
  answer(null);
});

async function ask(question: string, hidden = false): Promise<string> {
  stdout.write(question);
  muted = hidden;
  const line =
    lines.shift() ??
    (closed
      ? null
      : await new Promise<string | null>((resolve) => {
          waiting = resolve;
        }));
  muted = false;
  if (hidden) stdout.write("\n");
  if (line === null) fail("Stopped. Nothing changed.");
  return line.trim();
}

const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const disabling = argv.includes("--disable");

console.log(`Database: ${new URL(url).host}`);
const number = await ask("Employee number: ");
if (!/^[0-9]{1,6}$/.test(number)) fail("An employee number is 1 to 6 digits.");

if (disabling) {
  const { error } = await db.rpc("disable_manager_pin", { p_number: number, p_actor: null });
  if (error) fail(REFUSED[error.message] ?? "The PIN couldn't be turned off. Check the connection and try again.");
  console.log(`\n✓ The PIN for number ${number} is off, and any open session of theirs has ended.`);
} else {
  const pin = await ask("New PIN (hidden): ", true);
  const problem = pinProblem(pin);
  if (problem) fail(problem);
  if ((await ask("Same PIN again (hidden): ", true)) !== pin) fail("The two PINs were different. Nothing changed.");

  const { error } = await db.rpc("set_manager_pin", { p_number: number, p_pin_hash: await hash(pin, PIN_HASH_COST), p_actor: null });
  if (error) fail(REFUSED[error.message] ?? "The PIN couldn't be saved. Check the connection and try again.");
  console.log(`\n✓ The PIN for number ${number} is set, and any open session of theirs has ended.`);
}
prompt.close();
