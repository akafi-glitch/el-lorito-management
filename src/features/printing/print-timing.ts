/**
 * When a browser lets a page print. Safari only prints straight away from inside a tap: once the app has
 * waited for the server, a print call gets "blocked from automatically printing". Every browser on an iPad or
 * iPhone is Safari underneath, and an iPad says it is a Mac, so it shows by its touch screen.
 */
export function needsTapToPrint(browser: { userAgent: string; maxTouchPoints: number; tapStillCounts: boolean | undefined }): boolean {
  const { userAgent, maxTouchPoints, tapStillCounts } = browser;
  const onIos = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const desktopSafari = /Safari\//.test(userAgent) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(userAgent);
  return onIos || desktopSafari || tapStillCounts !== true;
}

/** True when the receipt is on the page with something on it, so a print can't come out blank. */
export function receiptIsOnPage(root: { querySelector: (selector: string) => { textContent: string | null } | null }): boolean {
  return (root.querySelector(".receipt-print")?.textContent?.trim() ?? "") !== "";
}
