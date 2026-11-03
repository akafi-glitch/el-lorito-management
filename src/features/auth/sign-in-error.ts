/**
 * What to tell someone whose sign-in failed. A wrong username, a wrong password, and an account that can't
 * sign in all read the same, so the page says nothing about who exists. Anything that isn't about what was
 * typed says so, or people keep retyping a correct password.
 */

export const WRONG_CREDENTIALS = "Username or password is wrong.";
export const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait a minute, then try again.";
export const SIGN_IN_BLOCKED = "The security check could not be verified. Try again. Your password was not rejected.";
export const SIGN_IN_UNAVAILABLE = "Couldn't sign in right now. Your password wasn't checked. Check the connection and try again.";

export function signInFailureMessage(error: { code?: string; status?: number } | null): string {
  if (error?.status === 429 || error?.code === "over_request_rate_limit") return TOO_MANY_ATTEMPTS;
  if (error?.code === "captcha_failed") return SIGN_IN_BLOCKED;
  if (error && (error.status === undefined || error.status === 0 || error.status >= 500)) return SIGN_IN_UNAVAILABLE;
  return WRONG_CREDENTIALS;
}
