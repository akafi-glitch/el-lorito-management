import { mkdirSync } from "node:fs";

import { chromium, type FullConfig } from "@playwright/test";

import { db } from "./support/db";
import { testEnv } from "./support/env";

/**
 * Creates the test administrator (if needed) and signs in once; every test reuses that sign-in.
 */
export default async function globalSetup(config: FullConfig) {
  const env = testEnv();
  const email = `${env.username}@staff.ellorito-management.com`;
  const admin = db().auth.admin;

  const created = await admin.createUser({ email, password: env.password, email_confirm: true });
  if (created.data.user) {
    const { error } = await db()
      .from("app_users")
      .upsert({ user_id: created.data.user.id, username: env.username, display_name: "E2E Admin", is_active: true });
    if (error) throw new Error(`Could not add the test administrator: ${error.message}`);
  } else if (!/already|exists|registered/i.test(created.error?.message ?? "")) {
    throw new Error(`Could not create the test administrator: ${created.error?.message}`);
  }

  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3100";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/sign-in`);
  await page.fill("input[name=username]", env.username);
  await page.fill("input[name=password]", env.password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${baseURL}/`);
  mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
  await browser.close();
}
