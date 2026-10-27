import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const header = (headers: { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("lets the page talk only to itself and the Supabase project (HTTPS and secure websocket)", () => {
    const csp = contentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co", development: false, https: true });
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co;");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("uses plain websockets for a local Supabase, and doesn't force HTTPS off Vercel", () => {
    const csp = contentSecurityPolicy({ supabaseUrl: "http://127.0.0.1:54321", development: false, https: false });
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321;");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("allows the development server's extras only in development", () => {
    const csp = contentSecurityPolicy({ supabaseUrl: undefined, development: true, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });

  it("forbids framing and sniffing everywhere; HSTS only on Vercel", () => {
    const local = securityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(header(local, "X-Frame-Options")).toBe("DENY");
    expect(header(local, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(local, "Strict-Transport-Security")).toBeUndefined();

    const vercel = securityHeaders({ NODE_ENV: "production", VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" });
    expect(header(vercel, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(header(vercel, "Content-Security-Policy")).toContain("wss://abc.supabase.co");
  });

  it("never puts a key in a header", () => {
    const all = JSON.stringify(securityHeaders({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" }));
    expect(all).not.toContain("sb_secret");
  });
});
