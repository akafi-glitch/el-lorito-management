import type { FloorRows, SectionRow } from "./schema";
import { deriveTableStatus, STATUS_ORDER, type TableStatus, type VisitSnapshot } from "./status";

/** Everything the floor map screen needs, built from database rows by pure code (easy to test). */

export type FloorTable = {
  id: string;
  code: string;
  label: string;
  capacity: number | null;
  section: { code: string; name: string; kind: SectionRow["kind"] };
  row: number;
  col: number;
  status: TableStatus;
  guestCount: number | null;
};

export type FloorArea = {
  code: string;
  name: string;
  placement: { row: number; col: number; rowSpan: number; colSpan: number };
  grid: { rows: number; cols: number };
  /** Sections drawn in this area, in display order (X shows X(1) and X(2)). */
  sections: { code: string; name: string; kind: SectionRow["kind"]; isOpen: boolean }[];
  tables: FloorTable[];
};

export type FloorCombination = {
  code: string;
  label: string;
  tableCodes: string[];
  /** Sum of chairs; null when any member's capacity is unknown. */
  capacity: number | null;
  allowsOverTwelve: boolean;
};

export type FloorMap = {
  areas: FloorArea[];
  combinations: FloorCombination[];
  counts: Record<TableStatus, number>;
  tableCount: number;
};

export class FloorLayoutError extends Error {
  constructor(message: string) {
    super(`Floor layout problem: ${message}`);
    this.name = "FloorLayoutError";
  }
}

/** Combined capacity is the sum of chairs (owner decision); unknown if any table is unknown. */
export function combinedCapacity(capacities: readonly (number | null)[]): number | null {
  if (capacities.length === 0) return null;
  let total = 0;
  for (const capacity of capacities) {
    if (capacity === null) return null;
    total += capacity;
  }
  return total;
}

export function buildFloorMap(rows: FloorRows, visits: ReadonlyMap<string, VisitSnapshot> = new Map()): FloorMap {
  const sectionsByCode = new Map(rows.sections.map((section) => [section.code, section]));
  const areaCodes = new Set(rows.areas.map((area) => area.code));
  const tablesById = new Map(rows.tables.map((table) => [table.id, table]));
  const occupiedCells = new Set<string>();
  const counts: Record<TableStatus, number> = { vacant: 0, "chips-needed": 0, "chips-served": 0, closed: 0 };

  const activeTables = rows.tables.filter((table) => table.is_active);
  const tablesByArea = new Map<string, FloorTable[]>();

  for (const table of activeTables) {
    const section = sectionsByCode.get(table.section_code);
    if (!section) throw new FloorLayoutError(`table ${table.code} belongs to unknown section ${table.section_code}`);
    if (!areaCodes.has(table.area_code)) {
      throw new FloorLayoutError(`table ${table.code} is placed in unknown area ${table.area_code}`);
    }
    const cell = `${table.area_code}:${table.layout_row}:${table.layout_col}`;
    if (occupiedCells.has(cell)) throw new FloorLayoutError(`two tables share one spot (${cell})`);
    occupiedCells.add(cell);

    const visit = visits.get(table.id) ?? null;
    const status = deriveTableStatus({ sectionOpen: section.is_open, visit });
    counts[status] += 1;

    const floorTable: FloorTable = {
      id: table.id,
      code: table.code,
      label: table.label,
      capacity: table.capacity,
      section: { code: section.code, name: section.name, kind: section.kind },
      row: table.layout_row,
      col: table.layout_col,
      status,
      guestCount: visit?.guestCount ?? null,
    };
    const list = tablesByArea.get(table.area_code) ?? [];
    list.push(floorTable);
    tablesByArea.set(table.area_code, list);
  }

  const areas: FloorArea[] = [...rows.areas]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((area) => {
      const tables = (tablesByArea.get(area.code) ?? []).sort((a, b) => a.row - b.row || a.col - b.col);
      const sectionCodes = [...new Set(tables.map((table) => table.section.code))];
      const sections = sectionCodes
        .map((code) => sectionsByCode.get(code))
        .filter((section): section is SectionRow => section !== undefined)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((section) => ({ code: section.code, name: section.name, kind: section.kind, isOpen: section.is_open }));
      return {
        code: area.code,
        name: area.name,
        placement: { row: area.floor_row, col: area.floor_col, rowSpan: area.row_span, colSpan: area.col_span },
        grid: {
          rows: Math.max(0, ...tables.map((table) => table.row)),
          cols: Math.max(0, ...tables.map((table) => table.col)),
        },
        sections,
        tables,
      };
    });

  const combinations: FloorCombination[] = rows.combinations
    .filter((combination) => combination.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((combination) => {
      const members = combination.table_combination_members.map(({ table_id }) => {
        const table = tablesById.get(table_id);
        if (!table) throw new FloorLayoutError(`combination ${combination.code} uses an unknown table`);
        return table;
      });
      if (members.length < 2) throw new FloorLayoutError(`combination ${combination.code} has fewer than two tables`);
      return {
        code: combination.code,
        label: combination.label,
        tableCodes: members.map((table) => table.code).sort(naturalCompare),
        capacity: combinedCapacity(members.map((table) => table.capacity)),
        allowsOverTwelve: combination.allows_over_twelve,
      };
    });

  return { areas, combinations, counts, tableCount: activeTables.length };
}

/** "X6" before "X10": compares the letter part, then the number. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export { STATUS_ORDER };
