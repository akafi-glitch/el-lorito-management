import { describe, expect, it } from "vitest";

import { EnvError, parsePublicEnv, parseServerEnv } from "@/lib/env-schema";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  SUPABASE_SECRET_KEY: "sb_secret_xyz789",
};

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

describe("server configuration", () => {
  it("accepts a complete configuration and defaults the time zone to America/Chicago", () => {
    const env = parseServerEnv(valid);
    expect(env.APP_TIME_ZONE).toBe("America/Chicago");
    expect(env.SUPABASE_SECRET_KEY).toBe("sb_secret_xyz789");
  });

  it("rejects a missing project URL", () => {
    const problems = problemsOf(() => parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: undefined }));
    expect(problems.join(" ")).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("rejects a missing secret key", () => {
    const problems = problemsOf(() => parseServerEnv({ ...valid, SUPABASE_SECRET_KEY: undefined }));
    expect(problems.join(" ")).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it("rejects a secret key stored under any NEXT_PUBLIC_ name", () => {
    const problems = problemsOf(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_ANYTHING: "sb_secret_leaked" }),
    );
    expect(problems.join(" ")).toMatch(/NEXT_PUBLIC_ANYTHING contains a secret key/);
  });

  it("rejects the two keys swapped", () => {
    const problems = problemsOf(() =>
      parseServerEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_xyz789",
        SUPABASE_SECRET_KEY: "sb_publishable_abc123",
      }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects an unknown time zone", () => {
    const problems = problemsOf(() => parseServerEnv({ ...valid, APP_TIME_ZONE: "Mars/Olympus" }));
    expect(problems.join(" ")).toMatch(/APP_TIME_ZONE/);
  });

  it("never includes key values in error messages", () => {
    const error = (() => {
      try {
        parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_LEAK: "sb_secret_topsecret" });
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();
    expect(error).not.toBeNull();
    expect(error?.message).not.toContain("sb_secret_topsecret");
    expect(error?.message).not.toContain("sb_secret_xyz789");
  });
});

describe("browser configuration", () => {
  it("needs only the URL and publishable key", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    expect(Object.keys(env).sort()).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });
});
