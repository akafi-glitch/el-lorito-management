import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn());
const endPinSession = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({ createSessionClient: async () => ({ auth }) }));
vi.mock("@/features/pin/session", () => ({ endPinSession }));
vi.mock("./session", () => ({
  findAppUser: async () => ({ isActive: false }),
  getSessionState: async () => ({ status: "signed-in", user: { userId: "user-1" } }),
}));

import { signIn, signOut } from "./actions";
import { SIGN_IN_BLOCKED, SIGN_IN_UNAVAILABLE, signInFailureMessage, TOO_MANY_ATTEMPTS, WRONG_CREDENTIALS } from "./sign-in-error";

beforeEach(() => vi.clearAllMocks());

describe("why a sign-in failed", () => {
  it("a wrong password, or an account that can't sign in, reads the same", () => {
    expect(signInFailureMessage({ code: "invalid_credentials", status: 400 })).toBe(WRONG_CREDENTIALS);
    expect(signInFailureMessage({ code: "email_not_confirmed", status: 400 })).toBe(WRONG_CREDENTIALS);
    expect(signInFailureMessage({ code: "user_banned", status: 400 })).toBe(WRONG_CREDENTIALS);
    expect(signInFailureMessage(null)).toBe(WRONG_CREDENTIALS);
  });

  it("CAPTCHA says it isn't the password", () => {
    expect(signInFailureMessage({ code: "captcha_failed", status: 400 })).toBe(SIGN_IN_BLOCKED);
    expect(SIGN_IN_BLOCKED).toContain("not by your password");
  });

  it("too many tries says to wait", () => {
    expect(signInFailureMessage({ status: 429 })).toBe(TOO_MANY_ATTEMPTS);
    expect(signInFailureMessage({ code: "over_request_rate_limit", status: 400 })).toBe(TOO_MANY_ATTEMPTS);
  });

  it("a server or connection problem says the password wasn't checked", () => {
    expect(signInFailureMessage({ status: 500 })).toBe(SIGN_IN_UNAVAILABLE);
    expect(signInFailureMessage({ status: 0 })).toBe(SIGN_IN_UNAVAILABLE);
    expect(signInFailureMessage({})).toBe(SIGN_IN_UNAVAILABLE);
  });
});

function form(): FormData {
  const data = new FormData();
  data.set("username", "lorito2014");
  data.set("password", "not-a-real-password");
  return data;
}

describe("the sign-in page", () => {
  it("shows the real reason when Supabase refuses for CAPTCHA", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "captcha_failed", status: 400 } });
    expect((await signIn({ error: null, username: "" }, form())).error).toBe(SIGN_IN_BLOCKED);
  });

  it("still gives one message for a wrong password", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", status: 400 } });
    expect((await signIn({ error: null, username: "" }, form())).error).toBe(WRONG_CREDENTIALS);
  });

  it("a turned-off account leaves only this device's session", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    await signIn({ error: null, username: "" }, form());
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("signing out", () => {
  it("ends this device's session only, so the restaurant's other devices stay signed in", async () => {
    await signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("locks the PIN areas on this device first", async () => {
    await signOut();
    expect(endPinSession).toHaveBeenCalledWith("user-1", "sign_out");
  });
});
