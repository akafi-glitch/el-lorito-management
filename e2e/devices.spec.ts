import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { employee, seat } from "./support/db";

/** Every working screen on a phone, a tablet, and a computer: nothing runs off the side. */
const PAGES = ["/", "/floor", "/waiter", "/waiter/01", "/waiter/01/tables/P5?continue=1", "/manage", "/manage/employees", "/manage/menu", "/manage/accounts"];
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "computer", width: 1440, height: 900 },
];

test.beforeAll(async () => {
  await employee("01", "Kafi", "waiter");
  await seat(["P5"], 2);
});

for (const size of SIZES) {
  test(`${size.name}: no page scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} on a ${size.name}`).toBeLessThanOrEqual(0);
    }
  });
}

test("tap targets on the floor and the menu are at least 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  for (const path of ["/floor", "/waiter/01/tables/P5?continue=1"]) {
    await page.goto(path);
    const small = await page.$$eval("main button, main a", (elements) =>
      elements
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.height < 44 || box.width < 44);
        })
        .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName),
    );
    expect(small, path).toEqual([]);
  }
});

test("no serious accessibility problems on the working screens", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target.join(" ")}`);
    expect(serious, path).toEqual([]);
  }
});

test("no page breaks the security policy (content security policy violations)", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(violations, path).toEqual([]);
  }
  const csp = (await page.request.get("/")).headers()["content-security-policy"];
  expect(csp).toContain("frame-ancestors 'none'");
});
