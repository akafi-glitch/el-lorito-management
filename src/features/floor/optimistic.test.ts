import { describe, expect, it } from "vitest";
import { z } from "zod";

import fixture from "../../../tests/fixtures/floor-rows.json";

import { allTables, buildFloorMap, type FloorMap } from "./layout";
import { applyChanges, NO_CHANGES, settleChanges, type FloorChanges } from "./optimistic";
import { combinationRowSchema, floorAreaRowSchema, sectionRowSchema, tableRowSchema } from "./schema";
import type { VisitSnapshot } from "./status";

const rows = {
  areas: z.array(floorAreaRowSchema).parse(fixture.areas),
  sections: z.array(sectionRowSchema).parse(fixture.sections),
  tables: z.array(tableRowSchema).parse(fixture.tables),
  combinations: z.array(combinationRowSchema).parse(fixture.combinations),
};

function floor(seated: Record<string, { visitId: number; version?: number; chipsServed?: boolean; labels?: string[] }>): FloorMap {
  const visits = new Map<string, VisitSnapshot>();
  for (const [code, visit] of Object.entries(seated)) {
    const id = rows.tables.find((table) => table.code === code)!.id;
    visits.set(id, {
      visitId: visit.visitId,
      version: visit.version ?? 1,
      guestCount: 2,
      chipsServed: visit.chipsServed ?? false,
      tableLabels: visit.labels ?? [code],
    });
  }
  return buildFloorMap(rows, { visits });
}

const table = (map: FloorMap, code: string) => allTables(map).find((t) => t.code === code)!;
const changes = (visits: FloorChanges["visits"], seats: FloorChanges["seats"] = []): FloorChanges => ({ visits, seats });

describe("a tap shows its result at once", () => {
  it("chips served: yellow turns red before the server answers", () => {
    const shown = applyChanges(floor({ A1: { visitId: 1 } }), changes(new Map([[1, { chipsServed: true, version: null }]])));
    expect(table(shown, "A1").status).toBe("chips-served");
    expect(table(shown, "A1").pending).toBe(true);
    expect(shown.counts["chips-needed"]).toBe(0);
    expect(shown.counts["chips-served"]).toBe(1);
  });

  it("joined tables change together", () => {
    const seated = floor({ X6: { visitId: 1, labels: ["X6", "X7", "X8"] }, X7: { visitId: 1 }, X8: { visitId: 1 } });
    const shown = applyChanges(seated, changes(new Map([[1, { chipsServed: true, version: null }]])));
    expect(["X6", "X7", "X8"].map((code) => table(shown, code).status)).toEqual(["chips-served", "chips-served", "chips-served"]);
  });

  it("the new version is used as soon as it is known, so Undo can't use an old one", () => {
    const shown = applyChanges(floor({ A1: { visitId: 1 } }), changes(new Map([[1, { chipsServed: true, version: 2 }]])));
    expect(table(shown, "A1").visit?.version).toBe(2);
    expect(table(shown, "A1").pending).toBe(false);
  });

  it("undo: red turns yellow", () => {
    const shown = applyChanges(floor({ A1: { visitId: 1, chipsServed: true } }), changes(new Map([[1, { chipsServed: false, version: null }]])));
    expect(table(shown, "A1").status).toBe("chips-needed");
  });

  it("clearing: red turns green", () => {
    const shown = applyChanges(floor({ A1: { visitId: 1, chipsServed: true } }), changes(new Map([[1, { cleared: true, version: null }]])));
    expect(table(shown, "A1").status).toBe("vacant");
    expect(table(shown, "A1").visit).toBeNull();
  });

  it("seating: green turns yellow on every table of the party", () => {
    const shown = applyChanges(floor({}), changes(new Map(), [{ id: 1, tableCodes: ["B3", "B4"], guestCount: 9, tableLabels: ["B3", "B4"] }]));
    expect(table(shown, "B3").status).toBe("chips-needed");
    expect(table(shown, "B4").visit?.tableLabels).toEqual(["B3", "B4"]);
    expect(shown.counts.vacant).toBe(43);
  });

  it("a table taken by someone else meanwhile keeps its real state", () => {
    const shown = applyChanges(floor({ B3: { visitId: 5 } }), changes(new Map(), [{ id: 1, tableCodes: ["B3"], guestCount: 2, tableLabels: ["B3"] }]));
    expect(table(shown, "B3").visit?.visitId).toBe(5);
  });

  it("nothing pending: the floor is exactly the saved floor", () => {
    const saved = floor({});
    expect(applyChanges(saved, NO_CHANGES)).toBe(saved);
  });
});

describe("the server's floor takes over", () => {
  const pending = changes(new Map([[1, { chipsServed: true, version: null }]]));

  it("a change still on its way stays", () => {
    expect(settleChanges(floor({ A1: { visitId: 1 } }), pending)).toBe(pending);
  });

  it("an answered change stays until the floor shows that version", () => {
    const answered = changes(new Map([[1, { chipsServed: true, version: 2 }]]));
    expect(settleChanges(floor({ A1: { visitId: 1, version: 1 } }), answered).visits.size).toBe(1);
    expect(settleChanges(floor({ A1: { visitId: 1, version: 2, chipsServed: true } }), answered).visits.size).toBe(0);
  });

  it("a newer change from another device wins over this one", () => {
    const answered = changes(new Map([[1, { chipsServed: true, version: 2 }]]));
    expect(settleChanges(floor({ A1: { visitId: 1, version: 3 } }), answered).visits.size).toBe(0);
  });

  it("a cleared table stops showing as soon as the visit is gone", () => {
    const answered = changes(new Map([[1, { cleared: true, version: 3 }]]));
    expect(settleChanges(floor({}), answered).visits.size).toBe(0);
  });

  it("a seated party stops being a guess once the floor shows it", () => {
    const seat = changes(new Map(), [{ id: 1, tableCodes: ["B3"], guestCount: 2, tableLabels: ["B3"] }]);
    expect(settleChanges(floor({}), seat).seats).toHaveLength(1);
    expect(settleChanges(floor({ B3: { visitId: 5 } }), seat).seats).toHaveLength(0);
  });
});
