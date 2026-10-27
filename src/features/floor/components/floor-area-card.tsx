"use client";

import type { CSSProperties } from "react";

import type { FloorArea, FloorTable, SectionInfo } from "../layout";

import { TableTile } from "./table-tile";

type FloorAreaCardProps = {
  area: FloorArea;
  selectedCodes: ReadonlySet<string>;
  busy: boolean;
  onTablePress: (table: FloorTable) => void;
  onSectionToggle: (section: SectionInfo) => void;
};

/** One block of the floor (Section A, Bar, Section X…), with its tables placed as drawn. */
export function FloorAreaCard({ area, selectedCodes, busy, onTablePress, onSectionToggle }: FloorAreaCardProps) {
  const mixedSections = area.sections.length > 1;
  // More than three tables across (the Bar) wraps to two per row on phones.
  const wrapOnPhone = area.grid.cols > 3;

  const placement = {
    "--area-row": `${area.placement.row} / span ${area.placement.rowSpan}`,
    "--area-col": `${area.placement.col} / span ${area.placement.colSpan}`,
    "--grid-cols": `repeat(${area.grid.cols}, minmax(0, 1fr))`,
    "--grid-rows": `repeat(${area.grid.rows}, auto)`,
  } as CSSProperties;

  return (
    <section
      aria-labelledby={`area-${area.code}`}
      className="rounded-2xl border border-glaze bg-paper p-4 lg:[grid-column:var(--area-col)] lg:[grid-row:var(--area-row)]"
      style={placement}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`area-${area.code}`} className="text-lg font-bold text-ink">
          {area.name}
          {area.sections.some((section) => !section.isOpen) ? (
            <span className="ml-2 rounded-md bg-status-closed/25 px-2 py-0.5 text-sm font-semibold text-ink">
              Closed: {area.sections.filter((section) => !section.isOpen).map((section) => section.name).join(", ")}
            </span>
          ) : null}
        </h2>
        <div className="flex flex-wrap gap-2">
          {area.sections.map((section) => (
            <button
              key={section.code}
              type="button"
              disabled={busy}
              onClick={() => onSectionToggle(section)}
              aria-label={`${section.isOpen ? "Close" : "Open"} section ${section.name}`}
              className={`min-h-10 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60 ${
                section.isOpen
                  ? "border-glaze bg-paper text-muted hover:border-cobalt hover:text-cobalt"
                  : "border-ink bg-ink text-white hover:bg-cobalt-deep"
              }`}
            >
              {section.isOpen ? `Close ${section.name}` : `Open ${section.name}`}
            </button>
          ))}
        </div>
      </header>
      <div
        className={`grid gap-2 ${
          wrapOnPhone
            ? "grid-cols-2 sm:[grid-template-columns:var(--grid-cols)]"
            : "[grid-template-columns:var(--grid-cols)] [grid-template-rows:var(--grid-rows)]"
        }`}
      >
        {area.tables.map((table) => (
          <TableTile
            key={table.id}
            table={table}
            showSection={mixedSections}
            wrapOnPhone={wrapOnPhone}
            selected={selectedCodes.has(table.code)}
            disabled={busy}
            onPress={onTablePress}
          />
        ))}
      </div>
    </section>
  );
}
