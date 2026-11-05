import { describe, expect, it } from "vitest";

import { needsTapToPrint, receiptIsOnPage } from "./print-timing";

const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_ON_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("whether printing needs one more tap", () => {
  it("does on an iPad, even one that calls itself a Mac, and even if the browser says the tap still counts", () => {
    expect(needsTapToPrint({ userAgent: IPAD, maxTouchPoints: 5, tapStillCounts: true })).toBe(true);
    expect(needsTapToPrint({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5, tapStillCounts: true })).toBe(true);
  });

  it("does for any browser on an iPad, because they are all Safari underneath", () => {
    expect(needsTapToPrint({ userAgent: CHROME_ON_IPAD, maxTouchPoints: 5, tapStillCounts: true })).toBe(true);
  });

  it("does for Safari on a Mac", () => {
    expect(needsTapToPrint({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0, tapStillCounts: true })).toBe(true);
  });

  it("doesn't for Chrome while the tap still counts", () => {
    expect(needsTapToPrint({ userAgent: CHROME, maxTouchPoints: 0, tapStillCounts: true })).toBe(false);
  });

  it("does for Chrome once the tap has run out, or when the browser can't say", () => {
    expect(needsTapToPrint({ userAgent: CHROME, maxTouchPoints: 0, tapStillCounts: false })).toBe(true);
    expect(needsTapToPrint({ userAgent: CHROME, maxTouchPoints: 0, tapStillCounts: undefined })).toBe(true);
  });
});

describe("whether the receipt is ready to print", () => {
  const page = (text: string | null) => ({ querySelector: () => (text === null ? null : { textContent: text }) });

  it("is when it is on the page with something on it", () => {
    expect(receiptIsOnPage(page("TICKET #1001"))).toBe(true);
  });

  it("isn't when it is missing or empty, which would print a blank page", () => {
    expect(receiptIsOnPage(page(null))).toBe(false);
    expect(receiptIsOnPage(page("  "))).toBe(false);
  });
});
