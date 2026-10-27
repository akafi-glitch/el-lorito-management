/**
 * Turns database refusals into plain words for staff. The database functions raise a stable key
 * as the message (for example "table_occupied") and the table or section names as the detail.
 */

type DbError = { code?: string | null; message?: string | null; details?: string | null };

const withDetail = (detail: string | null | undefined, fallback: string) => (detail && detail.trim()) || fallback;

export function seatingErrorMessage(error: DbError): string {
  const detail = error.details ?? null;
  // 23505 = the one-open-visit-per-table index caught a race the earlier check couldn't see.
  if (error.code === "23505") return "That table was just taken on another device. The floor has been refreshed.";

  switch (error.message) {
    case "table_occupied":
      return `${withDetail(detail, "That table")} was just taken on another device. The floor has been refreshed.`;
    case "section_closed":
      return `${detail?.trim() ? `Section ${detail.trim()}` : "That section"} is closed. Open the section first, then seat the guests.`;
    case "invalid_guest_count":
      return "Enter a number of guests from 1 to 100.";
    case "no_tables":
      return "Choose at least one table.";
    case "duplicate_tables":
      return "A table was chosen twice.";
    case "table_not_found":
      return `${withDetail(detail, "That table")} isn't on the floor plan.`;
    case "table_inactive":
      return `${withDetail(detail, "That table")} is out of use.`;
    case "combination_not_found":
    case "combination_mismatch":
      return "That combination doesn't match its tables. Choose the tables again.";
    case "stale_visit":
      return "This table was changed on another device. The floor has been refreshed; try again.";
    case "visit_closed":
      return "This table was already cleared.";
    case "visit_not_found":
      return "That party is no longer on the floor. The floor has been refreshed.";
    case "chips_already_served":
      return "Chips were already marked served.";
    case "chips_not_served":
      return "Mark chips served before clearing the table.";
    case "section_not_found":
      return "That section isn't on the floor plan.";
    default:
      return "The change couldn't be saved. Check the connection and try again.";
  }
}

/** Errors after which the screen is out of date and should reload the floor. */
export function shouldRefresh(error: DbError): boolean {
  return (
    error.code === "23505" ||
    ["table_occupied", "section_closed", "stale_visit", "visit_closed", "visit_not_found", "chips_already_served"].includes(
      error.message ?? "",
    )
  );
}
