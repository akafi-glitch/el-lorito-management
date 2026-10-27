"use client";

import type { CSSProperties } from "react";

import type { FloorArea, FloorTable, SectionInfo, SectionStaff } from "../layout";

import { TableTile } from "./table-tile";

type FloorAreaCardProps = {
  area: FloorArea;
  staff: Readonly<Record<string, SectionStaff>>;
  selectedCodes: ReadonlySet<string>;
  busy: boolean;
  onTablePress: (table: FloorTable) => void;
  onSectionToggle: (section: SectionInfo) => void;
};

/** One block of the floor (Section A, Bar, Section X…), with its tables placed as drawn. */
export function FloorAreaCard({ area, staff, selectedCodes, busy, onTablePress, onSectionToggle }: FloorAreaCardProps) {
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
              className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60 ${
                section.isOpen
                  ? "border-glaze bg-paper text-muted hover:border-leaf hover:text-leaf"
                  : "border-ink bg-ink text-white hover:bg-leaf-deep"
              }`}
            >
              {section.isOpen ? `Close ${section.name}` : `Open ${section.name}`}
            </button>
          ))}
        </div>
      </header>
      <div className="-mt-1 mb-3 flex flex-col gap-0.5 text-sm">
        {area.sections.map((section) => {
          const people = staff[section.code];
          const waiter = section.kind === "bar" ? "any waiter" : (people?.waiter ?? "not assigned");
          const runner = people?.runner ?? "not assigned";
          return (
            <p key={section.code} className="flex flex-wrap gap-x-1">
              {area.sections.length > 1 ? <span className="font-semibold text-ink">{section.name}:</span> : null}
              <span className="text-muted">
                Waiter <span className={people?.waiter || section.kind === "bar" ? "font-semibold text-ink" : ""}>{waiter}</span>
                , chips <span className={people?.runner ? "font-semibold text-ink" : ""}>{runner}</span>
              </span>
            </p>
          );
        })}
      </div>
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
