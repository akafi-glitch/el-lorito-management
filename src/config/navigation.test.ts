import { describe, expect, it } from "vitest";

import { allDestinations, managementDestination, primaryDestinations } from "./navigation";

describe("home navigation", () => {
  it("has exactly two main buttons: Floor Management, then Waiter Section", () => {
    expect(primaryDestinations.map((d) => [d.label, d.href])).toEqual([
      ["Floor Management", "/floor"],
      ["Waiter Section", "/waiter"],
    ]);
  });

  it("keeps Management as a separate, secondary destination", () => {
    expect(managementDestination.href).toBe("/manage");
    expect(primaryDestinations).not.toContain(managementDestination);
  });

  it("links only to the three app sections", () => {
    expect(allDestinations.map((d) => d.href).sort()).toEqual(["/floor", "/manage", "/waiter"]);
  });
});
