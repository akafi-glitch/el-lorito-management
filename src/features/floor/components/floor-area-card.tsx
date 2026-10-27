import type { CSSProperties } from "react";

import type { FloorArea } from "../layout";

import { TableTile } from "./table-tile";

/** One block of the floor (Section A, Bar, Section X…), with its tables placed as drawn. */
export function FloorAreaCard({ area }: { area: FloorArea }) {
  const mixedSections = area.sections.length > 1;
  // Name the sections only when the heading doesn't already ("Section X" → "X(1) and X(2)").
  const sectionNames = area.sections.map((section) => section.name);
  const showSectionNames = mixedSections && !sectionNames.every((name) => area.name.includes(name));
  // More than three tables across (the Bar) wraps to two per row on phones.
  const wrapOnPhone = area.grid.cols > 3;
  const closedNames = area.sections.filter((section) => !section.isOpen).map((section) => section.name);

  const placement = {
    "--area-row": `${area.placement.row} / span ${area.placement.rowSpan}`,
    "--area-col": `${area.placement.col} / span ${area.placement.colSpan}`,
  } as CSSProperties;

  return (
    <section
      aria-labelledby={`area-${area.code}`}
      className="rounded-2xl border border-glaze bg-paper p-4 lg:[grid-column:var(--area-col)] lg:[grid-row:var(--area-row)]"
      style={placement}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`area-${area.code}`} className="text-lg font-bold text-ink">
          {area.name}
        </h2>
        <p className="text-sm text-muted">
          {showSectionNames ? sectionNames.join(" and ") : null}
          {closedNames.length > 0 ? (
            <span className="ml-2 font-semibold text-ink">Closed: {closedNames.join(", ")}</span>
          ) : null}
        </p>
      </header>
      <div
        className={`grid gap-2 ${
          wrapOnPhone
            ? "grid-cols-2 sm:[grid-template-columns:var(--grid-cols)]"
            : "[grid-template-columns:var(--grid-cols)] [grid-template-rows:var(--grid-rows)]"
        }`}
        style={
          {
            "--grid-cols": `repeat(${area.grid.cols}, minmax(0, 1fr))`,
            "--grid-rows": `repeat(${area.grid.rows}, auto)`,
          } as CSSProperties
        }
      >
        {area.tables.map((table) => (
          <TableTile key={table.id} table={table} showSection={mixedSections} wrapOnPhone={wrapOnPhone} />
        ))}
      </div>
    </section>
  );
}
