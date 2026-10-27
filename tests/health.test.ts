import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "sb_secret_health_test_value";
const PUBLISHABLE = "sb_publishable_health_test_value";

async function loadRoute() {
  vi.resetModules(); // the env module caches its result
  return import("@/app/api/health/route");
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports ok when configuration is valid, without revealing any key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE);
    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);

    const { GET } = await loadRoute();
    const response = GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ status: "ok", config: "valid", app: "el-lorito-management" });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PUBLISHABLE);
    expect(text).not.toContain("127.0.0.1");
  });

  it("returns 503 when configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    const { GET } = await loadRoute();
    const response = GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "misconfigured", config: "invalid" });
  });
});
