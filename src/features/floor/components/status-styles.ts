import type { TableStatus } from "../status";

/** Tile colors per status. Text labels always accompany color, so status never depends on color alone. */
export const STATUS_TILE: Record<TableStatus, string> = {
  vacant: "border-status-vacant bg-status-vacant/12",
  "chips-needed": "border-status-chips bg-status-chips/25",
  "chips-served": "border-status-served bg-status-served/15",
  closed: "border-status-closed border-dashed bg-status-closed/15",
};

export const STATUS_DOT: Record<TableStatus, string> = {
  vacant: "bg-status-vacant",
  "chips-needed": "bg-status-chips",
  "chips-served": "bg-status-served",
  closed: "bg-status-closed",
};
