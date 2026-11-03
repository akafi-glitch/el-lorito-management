/**
 * PIN rules (owner decision, Nov 2, 2026). Each manager has their own PIN for Order History and the Shift
 * Report. Pure code: the screen, the server, the admin script, and the tests share it.
 */

export const PIN_MIN_DIGITS = 6;
export const PIN_MAX_DIGITS = 12;
/** bcrypt's work factor: slow enough to make guessing from a stolen hash expensive. */
export const PIN_HASH_COST = 12;

export const IDLE_LIMIT_MS = 15 * 60 * 1000;
export const SESSION_LIMIT_SECONDS = 12 * 60 * 60;

/** The same words whatever went wrong, so they say nothing about who exists. */
export const INCORRECT_PIN_TEXT = "Incorrect PIN";
export const LOCKED_OUT_TEXT = "Too many attempts. Try again in 10 minutes.";

export function isPinFormat(value: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`).test(value);
}

/** For choosing a PIN: refuses one digit repeated, and digits simply counting up or down. */
export function pinProblem(pin: string): string | null {
  if (!isPinFormat(pin)) return `A PIN is ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`;
  const steps = [...pin].slice(1).map((digit, index) => (Number(digit) - Number(pin[index]) + 10) % 10);
  if (steps.every((step) => step === 0)) return "Choose a PIN that isn't one digit repeated.";
  if (steps.every((step) => step === 1) || steps.every((step) => step === 9)) return "Choose a PIN that isn't digits in order.";
  return null;
}

/** Keeps only digits, up to the longest PIN. */
export function cleanTypedPin(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, PIN_MAX_DIGITS);
}
