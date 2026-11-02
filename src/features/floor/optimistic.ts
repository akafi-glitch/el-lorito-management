import { allTables, type FloorMap, type FloorTable } from "./layout";
import { deriveTableStatus, type TableStatus } from "./status";

/**
 * What this device has just asked for, shown on the floor at once, before the server answers. Pure
 * code. The database still decides: on a refusal the change is dropped and the real state returns.
 */

export type VisitChange = {
  chipsServed?: boolean;
  cleared?: boolean;
  /** The visit's version once the server has answered; null while the request is on its way. */
  version: number | null;
};

export type PendingSeat = { id: number; tableCodes: string[]; guestCount: number; tableLabels: string[] };

export type FloorChanges = { visits: ReadonlyMap<number, VisitChange>; seats: readonly PendingSeat[] };

export const NO_CHANGES: FloorChanges = { visits: new Map(), seats: [] };

/** The floor as it will look once the pending changes are saved. */
export function applyChanges(map: FloorMap, changes: FloorChanges): FloorMap {
  if (changes.visits.size === 0 && changes.seats.length === 0) return map;

  const seatByCode = new Map(changes.seats.flatMap((seat) => seat.tableCodes.map((code) => [code, seat] as const)));
  const counts: Record<TableStatus, number> = { vacant: 0, "chips-needed": 0, "chips-served": 0, closed: 0 };

  const changeTable = (table: FloorTable): FloorTable => {
    let next = table;
    const seat = seatByCode.get(table.code);
    if (seat && table.visit === null) {
      next = {
        ...table,
        pending: true,
        status: "chips-needed",
        visit: { visitId: -seat.id, version: 0, guestCount: seat.guestCount, chipsServed: false, tableLabels: seat.tableLabels },
      };
    } else if (table.visit) {
      const change = changes.visits.get(table.visit.visitId);
      if (change?.cleared) {
        next = { ...table, pending: true, visit: null, status: deriveTableStatus({ sectionOpen: table.section.isOpen, visit: null }) };
      } else if (change) {
        const visit = {
          ...table.visit,
          chipsServed: change.chipsServed ?? table.visit.chipsServed,
          version: change.version ?? table.visit.version,
        };
        next = { ...table, pending: change.version === null, visit, status: deriveTableStatus({ sectionOpen: table.section.isOpen, visit }) };
      }
    }
    counts[next.status] += 1;
    return next;
  };

  return { ...map, areas: map.areas.map((area) => ({ ...area, tables: area.tables.map(changeTable) })), counts };
}

/** Drops changes the server's floor already shows; the server's newer state always wins. */
export function settleChanges(map: FloorMap, changes: FloorChanges): FloorChanges {
  const tables = allTables(map);
  const visits = new Map<number, VisitChange>();
  for (const [visitId, change] of changes.visits) {
    if (change.version === null) {
      visits.set(visitId, change); // still on its way
      continue;
    }
    const current = tables.find((table) => table.visit?.visitId === visitId)?.visit;
    if (current && current.version < change.version) visits.set(visitId, change);
  }
  const seats = changes.seats.filter((seat) => seat.tableCodes.some((code) => tables.find((table) => table.code === code)?.visit === null));
  if (visits.size === changes.visits.size && seats.length === changes.seats.length) return changes;
  return { visits, seats };
}
