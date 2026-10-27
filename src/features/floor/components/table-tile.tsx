import type { CSSProperties } from "react";

import type { FloorTable } from "../layout";
import { STATUS_LABEL } from "../status";

import { STATUS_TILE } from "./status-styles";

type TableTileProps = {
  table: FloorTable;
  /** Show which section the table belongs to (used where one block holds two sections, like X). */
  showSection: boolean;
  /** Let a wide row (the Bar) wrap on phones instead of keeping its drawn position. */
  wrapOnPhone: boolean;
};

function chairsText(capacity: number | null): string {
  if (capacity === null) return "Seats not set";
  return capacity === 1 ? "1 chair" : `${capacity} chairs`;
}

/** One table on the floor map. Phase 3 turns it into a button that seats guests and serves chips. */
export function TableTile({ table, showSection, wrapOnPhone }: TableTileProps) {
  const status = STATUS_LABEL[table.status];
  const detail = table.guestCount !== null ? `${table.guestCount} guests` : chairsText(table.capacity);
  const position = { "--tile-row": table.row, "--tile-col": table.col } as CSSProperties;
  const placement = wrapOnPhone
    ? "sm:[grid-row:var(--tile-row)] sm:[grid-column:var(--tile-col)]"
    : "[grid-row:var(--tile-row)] [grid-column:var(--tile-col)]";

  return (
    <div
      role="group"
      aria-label={`${table.label}, ${detail}, ${status}`}
      className={`flex min-h-[4.75rem] flex-col justify-center rounded-xl border-2 px-2 py-2 text-center ${placement} ${STATUS_TILE[table.status]}`}
      style={position}
    >
      {showSection ? (
        <span className="text-[0.7rem] font-semibold leading-none text-muted">{table.section.name}</span>
      ) : null}
      <span className="text-lg font-bold leading-tight text-ink">{table.label}</span>
      <span className="text-sm text-ink/80">{detail}</span>
      <span className="text-xs font-semibold text-ink/70">{status}</span>
    </div>
  );
}
