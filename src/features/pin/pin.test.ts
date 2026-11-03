import { compare, hash } from "bcryptjs";
import { describe, expect, it } from "vitest";

import { cookieSigningKey, newSessionToken, signToken, tokenHash, verifySignedToken } from "./cookie";
import { cleanTypedPin, isPinFormat, pinProblem } from "./rules";

describe("a PIN", () => {
  it("is 6 to 12 digits", () => {
    expect(isPinFormat("482913")).toBe(true);
    expect(isPinFormat("482913482913")).toBe(true);
    expect(isPinFormat("48291")).toBe(false);
    expect(isPinFormat("4829134829134")).toBe(false);
    expect(isPinFormat("48291a")).toBe(false);
    expect(isPinFormat("")).toBe(false);
  });

  it("can't be chosen too easy to guess", () => {
    expect(pinProblem("482913")).toBeNull();
    expect(pinProblem("12345")).toMatch(/6 to 12 digits/);
    expect(pinProblem("000000")).toMatch(/repeated/);
    expect(pinProblem("123456")).toMatch(/in order/);
    expect(pinProblem("654321")).toMatch(/in order/);
    expect(pinProblem("890123")).toMatch(/in order/);
  });

  it("is typed as digits only", () => {
    expect(cleanTypedPin("48 29a13")).toBe("482913");
    expect(cleanTypedPin("1234567890123456")).toBe("123456789012");
  });

  it("is stored only as a bcrypt hash that doesn't contain it", async () => {
    const stored = await hash("482913", 4);
    expect(stored).toMatch(/^\$2[aby]\$04\$[./A-Za-z0-9]{53}$/);
    expect(stored).not.toContain("482913");
    expect(await compare("482913", stored)).toBe(true);
    expect(await compare("482914", stored)).toBe(false);
  });
});

describe("the session cookie", () => {
  const key = cookieSigningKey("sb_secret_test_value");

  it("gives back the token it was signed with", () => {
    const token = newSessionToken();
    expect(verifySignedToken(signToken(token, key), key)).toBe(token);
  });

  it("refuses anything changed or made up", () => {
    const signed = signToken(newSessionToken(), key);
    const [token, signature] = signed.split(".") as [string, string];
    expect(verifySignedToken(`${newSessionToken()}.${signature}`, key)).toBeNull();
    expect(verifySignedToken(`${token}.${signature.slice(0, -2)}xx`, key)).toBeNull();
    expect(verifySignedToken(token, key)).toBeNull();
    expect(verifySignedToken(`${signed}.extra`, key)).toBeNull();
    expect(verifySignedToken("", key)).toBeNull();
  });

  it("refuses a signature from another key", () => {
    expect(verifySignedToken(signToken(newSessionToken(), cookieSigningKey("another secret")), key)).toBeNull();
  });

  it("uses a key that isn't the server secret, and a fresh token each time", () => {
    expect(key.toString("utf8")).not.toContain("sb_secret");
    expect(newSessionToken()).not.toBe(newSessionToken());
  });

  it("stores only a hash of the token", () => {
    const token = newSessionToken();
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(token)).not.toContain(token);
  });
});
