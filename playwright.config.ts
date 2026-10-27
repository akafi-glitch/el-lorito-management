import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: real browsers against the built app and a real Supabase stack (local or CI).
 * Never point these at the live project: they create test employees, visits, and tickets.
 *
 *   npx supabase start            # Postgres, Auth, REST, Realtime on this computer
 *   npm run build && npm run e2e  # starts the app on port 3100 and runs every test
 */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  // One shared database: run tests one after another so they don't seat each other's tables.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // In CI, failures also become GitHub annotations (readable on the pull request without the logs).
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    storageState: "e2e/.auth/admin.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 1000 } } }],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
