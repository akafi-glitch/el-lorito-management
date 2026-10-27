/**
 * Table status shown on the floor map. Occupancy and chips are separate facts in the database;
 * the color is derived from both. Phase 3 adds visits, so `visit` is always null in Phase 2.
 */

export type TableStatus = "vacant" | "chips-needed" | "chips-served" | "closed";

export type VisitSnapshot = { guestCount: number; chipsServed: boolean };

export function deriveTableStatus(input: { sectionOpen: boolean; visit: VisitSnapshot | null }): TableStatus {
  // An occupied table keeps its real status even if its section is closed meanwhile.
  if (input.visit) return input.visit.chipsServed ? "chips-served" : "chips-needed";
  return input.sectionOpen ? "vacant" : "closed";
}

export const STATUS_LABEL: Record<TableStatus, string> = {
  vacant: "Vacant",
  "chips-needed": "Needs chips",
  "chips-served": "Chips served",
  closed: "Section closed",
};

/** Display order for the legend and the counts. */
export const STATUS_ORDER: readonly TableStatus[] = ["vacant", "chips-needed", "chips-served", "closed"];
