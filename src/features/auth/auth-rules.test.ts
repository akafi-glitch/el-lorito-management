import { describe, expect, it } from "vitest";

import { isPublicPath, safeNextPath } from "./redirect";
import { signInSchema } from "./schema";
import { INTERNAL_EMAIL_DOMAIN, isValidUsername, normalizeUsername, usernameToEmail } from "./username";

describe("username rules", () => {
  it.each(["kafi", "jesus.m", "manager-1", "a01"])("accepts %s", (name) => {
    expect(isValidUsername(name)).toBe(true);
  });

  it.each(["ab", "Kafi", "kafi m", "-kafi", ".kafi", "kafi@x", "", "a".repeat(33)])("rejects %j", (name) => {
    expect(isValidUsername(name)).toBe(false);
  });

  it("normalizes spacing and capitals before checking", () => {
    expect(normalizeUsername("  Kafi ")).toBe("kafi");
  });

  it("maps a username to a hidden internal address on the restaurant domain", () => {
    expect(usernameToEmail("Kafi")).toBe(`kafi@${INTERNAL_EMAIL_DOMAIN}`);
  });

  it("refuses to map an invalid username", () => {
    expect(() => usernameToEmail("bad name")).toThrow(/Invalid username/);
  });
});

describe("sign-in form validation", () => {
  it("accepts a valid username and password", () => {
    const result = signInSchema.safeParse({ username: " Kafi ", password: "correct horse" });
    expect(result.success).toBe(true);
    expect(result.data?.username).toBe("kafi");
  });

  it("requires a password", () => {
    const result = signInSchema.safeParse({ username: "kafi", password: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter your password.");
  });

  it("rejects an invalid username before contacting the server", () => {
    expect(signInSchema.safeParse({ username: "k", password: "x" }).success).toBe(false);
  });
});

describe("after sign-in redirect", () => {
  it.each([
    [undefined, "/"],
    ["/floor", "/floor"],
    ["/waiter?table=A3", "/waiter?table=A3"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/sign-in", "/"],
  ])("next=%j goes to %j", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});

describe("public pages", () => {
  it("only sign-in and the health check open without signing in", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/floor")).toBe(false);
    expect(isPublicPath("/manage")).toBe(false);
    expect(isPublicPath("/sign-inside")).toBe(false);
  });
});
