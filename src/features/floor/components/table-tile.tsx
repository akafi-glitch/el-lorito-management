"use client";

import type { CSSProperties } from "react";

import type { FloorTable } from "../layout";
import { STATUS_LABEL } from "../status";

import { STATUS_TILE } from "./status-styles";

type TableTileProps = {
  table: FloorTable;
  /** Show which section the table belongs to (where one block holds two sections, like X). */
  showSection: boolean;
  /** Let a wide row (the Bar) wrap on phones instead of keeping its drawn position. */
  wrapOnPhone: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: (table: FloorTable) => void;
};

function chairsText(capacity: number | null): string {
  if (capacity === null) return "Seats not set";
  return capacity === 1 ? "1 chair" : `${capacity} chairs`;
}

function guestsText(count: number): string {
  return count === 1 ? "1 guest" : `${count} guests`;
}

/** One table on the floor map. Tap: select a free table, or act on a seated one. */
export function TableTile({ table, showSection, wrapOnPhone, selected, disabled, onPress }: TableTileProps) {
  const status = STATUS_LABEL[table.status];
  const visit = table.visit;
  const detail = visit ? guestsText(visit.guestCount) : chairsText(table.capacity);
  const partners = visit && visit.tableLabels.length > 1 ? visit.tableLabels.filter((l) => l !== table.label) : [];
  const position = { "--tile-row": table.row, "--tile-col": table.col } as CSSProperties;
  const placement = wrapOnPhone
    ? "sm:[grid-row:var(--tile-row)] sm:[grid-column:var(--tile-col)]"
    : "[grid-row:var(--tile-row)] [grid-column:var(--tile-col)]";
  // Ink, not brand green: a green ring would blend into a green (vacant) tile.
  const ring = selected ? "ring-4 ring-ink ring-offset-2 ring-offset-paper" : "";

  const spoken = [
    table.label,
    detail,
    partners.length > 0 ? `joined with ${partners.join(" and ")}` : null,
    selected ? "selected" : status,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      aria-label={spoken}
      aria-pressed={table.status === "vacant" ? selected : undefined}
      disabled={disabled}
      onClick={() => onPress(table)}
      className={`flex min-h-[4.75rem] flex-col items-center justify-center rounded-xl border-2 px-2 py-2 text-center transition-shadow disabled:cursor-wait ${placement} ${STATUS_TILE[table.status]} ${ring}`}
      style={position}
    >
      {showSection ? (
        <span className="text-[0.7rem] font-semibold leading-none text-muted">{table.section.name}</span>
      ) : null}
      <span className="text-lg font-bold leading-tight text-ink">{table.label}</span>
      <span className={`text-sm ${visit ? "font-bold text-ink" : "text-ink/80"}`}>{detail}</span>
      {partners.length > 0 ? (
        <span className="text-xs font-semibold text-ink">with {partners.join(" + ")}</span>
      ) : null}
      <span className="text-xs font-semibold text-ink/70">{selected ? "Selected" : status}</span>
    </button>
  );
}
