/**
 * Table status shown on the floor map. Occupancy and chips are separate facts in the database;
 * the color is derived from both.
 */

export type TableStatus = "vacant" | "chips-needed" | "chips-served" | "closed";

/** The open visit at a table, as the floor screen needs it. */
export type VisitSnapshot = {
  visitId: number;
  /** Raised by the database on every change; sent back so stale changes are refused. */
  version: number;
  guestCount: number;
  chipsServed: boolean;
  /** Every table this visit occupies (more than one for combined tables). */
  tableLabels: string[];
};

export function deriveTableStatus(input: {
  sectionOpen: boolean;
  visit: Pick<VisitSnapshot, "chipsServed"> | null;
}): TableStatus {
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
