import { expect, type Page } from "@playwright/test";

/**
 * Stands in for the browser's print dialog, and behaves like an iPad's: print() returns at once and the preview
 * is built afterwards. It keeps what was on the page at the moment of the call and a moment later, and how the
 * call came about, because a call from outside a tap is what Safari blocks.
 */
export async function stubPrinting(page: Page, previewAfterMs = 2500) {
  await page.addInitScript((delay) => {
    const w = window as unknown as { __prints: number; __receipts: string[]; __previews: string[]; __printEvents: string[]; print: () => void };
    w.__prints = 0;
    w.__receipts = [];
    w.__previews = [];
    w.__printEvents = [];
    w.print = () => {
      const text = () => document.querySelector(".receipt-print")?.textContent ?? "";
      w.__prints += 1;
      w.__receipts.push(text());
      w.__printEvents.push(window.event?.type ?? "none");
      setTimeout(() => w.__previews.push(text()), delay);
    };
  }, previewAfterMs);
}

type PrintLog = { __prints: number; __receipts: string[]; __previews: string[]; __printEvents: string[] };

export const prints = (page: Page) => page.evaluate(() => (window as unknown as PrintLog).__prints);
export const lastReceipt = (page: Page) => page.evaluate(() => (window as unknown as PrintLog).__receipts.at(-1) ?? "");
export const previews = (page: Page) => page.evaluate(() => (window as unknown as PrintLog).__previews);
export const printEvents = (page: Page) => page.evaluate(() => (window as unknown as PrintLog).__printEvents);

/** Waits until the print dialog has opened this many times, tapping Print now if this browser needs it. */
export async function waitForPrint(page: Page, times: number) {
  const printNow = page.getByRole("button", { name: "Print now", exact: true });
  await expect
    .poll(async () => {
      if (await printNow.isVisible().catch(() => false)) await printNow.click().catch(() => {});
      return prints(page);
    })
    .toBe(times);
}

export const answerYes = async (page: Page) => {
  await page.locator("dialog[open]").getByRole("button", { name: "Yes, it printed" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
};

export const answerNo = (page: Page) => page.locator("dialog[open]").getByRole("button", { name: "No, it didn't print" }).click();
