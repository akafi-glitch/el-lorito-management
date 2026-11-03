import { expect, type Page } from "@playwright/test";

import { MANAGER } from "./db";

/** On the PIN screen: employee number, then PIN, then Unlock. */
export async function enterPin(page: Page, number: string, pin: string): Promise<void> {
  await page.fill("#pin-employee", number);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.fill("#pin-value", pin);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
}

/** Opens a protected page as the test manager. */
export async function unlock(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await enterPin(page, MANAGER.number, MANAGER.pin);
  await expect(page.getByTestId("pin-bar")).toBeVisible();
}
