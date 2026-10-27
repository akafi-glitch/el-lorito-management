/**
 * Username rules shared by the app and the `admin:create` script.
 * Plain TypeScript with no imports, so Node can run it directly from the script.
 *
 * Supabase Auth signs people in by email address. Administrators sign in with a short username,
 * so each username maps to a hidden internal address on the restaurant's own domain.
 * Email sign-ups and confirmation emails are turned off, so these addresses never receive mail.
 */

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9.-]{2,31}$/;
export const USERNAME_RULE_TEXT =
  "3 to 32 characters: lowercase letters, numbers, dots or dashes, starting with a letter or number.";
export const PASSWORD_MIN_LENGTH = 10;
export const INTERNAL_EMAIL_DOMAIN = "staff.ellorito-management.com";

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export function usernameToEmail(username: string): string {
  const normalized = normalizeUsername(username);
  if (!isValidUsername(normalized)) {
    throw new Error(`Invalid username. ${USERNAME_RULE_TEXT}`);
  }
  return `${normalized}@${INTERNAL_EMAIL_DOMAIN}`;
}
