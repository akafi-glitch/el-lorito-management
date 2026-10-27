import type { OpenVisitTableRow, TableRow } from "./schema";
import type { VisitSnapshot } from "./status";

/** Groups open visit rows so every table of a combined party knows its partner tables. */
export function visitsByTable(rows: OpenVisitTableRow[], tables: TableRow[]): Map<string, VisitSnapshot> {
  const labelById = new Map(tables.map((table) => [table.id, table.label]));
  const labelsByVisit = new Map<number, string[]>();
  for (const row of rows) {
    const labels = labelsByVisit.get(row.visit_id) ?? [];
    labels.push(labelById.get(row.table_id) ?? "?");
    labelsByVisit.set(row.visit_id, labels);
  }

  const result = new Map<string, VisitSnapshot>();
  for (const row of rows) {
    const visit = row.customer_visits;
    if (visit.cleared_at !== null) continue; // released rows are filtered already; this is a safety net
    result.set(row.table_id, {
      visitId: visit.id,
      version: visit.version,
      guestCount: visit.guest_count,
      chipsServed: visit.chips_status === "served",
      tableLabels: (labelsByVisit.get(row.visit_id) ?? []).sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    });
  }
  return result;
}
