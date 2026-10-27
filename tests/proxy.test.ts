import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "@/lib/supabase/proxy-session";

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_proxy_test");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("page protection (proxy) for a signed-out visitor", () => {
  it.each(["/", "/floor", "/waiter", "/manage"])("sends %s to sign-in", async (path) => {
    configure();
    const response = await updateSession(request(path));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
  });

  it("remembers where the visitor was going", async () => {
    configure();
    const response = await updateSession(request("/floor"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/floor");
  });

  it.each(["/sign-in", "/api/health"])("lets %s through", async (path) => {
    configure();
    const response = await updateSession(request(path));
    expect(response.headers.get("location")).toBeNull();
  });

  it("fails closed when configuration is missing: protected pages still redirect", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const response = await updateSession(request("/manage"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
  });

  it("does not accept a forged session cookie", async () => {
    configure();
    const forged = request("/floor");
    forged.cookies.set("sb-127-auth-token", "base64-eyJmYWtlIjp0cnVlfQ");
    const response = await updateSession(forged);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
  });
});
