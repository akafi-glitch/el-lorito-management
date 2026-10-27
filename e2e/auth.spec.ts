import { expect, test } from "@playwright/test";

import { testEnv } from "./support/env";

// These start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("sign-in protects every page", () => {
  test("a signed-out visitor is sent to sign-in, then back where they wanted to go", async ({ page }) => {
    await page.goto("/floor");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ffloor/);
    const env = testEnv();
    await page.fill("input[name=username]", env.username);
    await page.fill("input[name=password]", env.password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/floor$/);
  });

  test("a wrong password is refused without saying which part was wrong", async ({ page }) => {
    await page.goto("/sign-in");
    await page.fill("input[name=username]", testEnv().username);
    await page.fill("input[name=password]", "not-the-password-1");
    await page.click("button[type=submit]");
    await expect(page.locator("#sign-in-error")).toHaveText("Username or password is wrong.");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the change counter needs a signed-in account", async ({ request }) => {
    const response = await request.get("/api/changes", { maxRedirects: 0 });
    expect([302, 303, 307, 401]).toContain(response.status());
  });

  test("the health check is public and shows no settings", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).not.toMatch(/sb_secret_|sb_publishable_|supabase\.co/);
  });
});

test.describe("signed in", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("home has Floor Management, Waiter Section, and Management", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("EL LORITO");
    await expect(page.getByRole("link", { name: /Floor Management/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Waiter Section/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Management/ }).first()).toBeVisible();
  });

  test("an unknown page says so and offers the way home", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to home" })).toBeVisible();
  });
});
