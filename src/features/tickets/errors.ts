type DbError = { code?: string | null; message?: string | null; details?: string | null };

/** Database refusals for tickets, in plain words. */
export function ticketErrorMessage(error: DbError): string {
  const detail = error.details?.trim() || null;
  const ticket = detail ? `Ticket #${detail}` : "This ticket";
  switch (error.message) {
    case "empty_ticket":
      return "Add at least one item before saving.";
    case "invalid_lines":
      return "The order couldn't be read. Reload the page and try again.";
    case "employee_not_found":
      return "Your employee number wasn't found. Enter it again.";
    case "employee_inactive":
      return `${detail ?? "This employee"} is turned off and can't save tickets. Ask a manager.`;
    case "visit_not_found":
    case "visit_closed":
      return "This table has been cleared, so its tickets can't be changed. The page has been refreshed.";
    case "ticket_not_found":
      return "That ticket isn't on this table. The page has been refreshed.";
    case "ticket_printed":
      return `${ticket} is printed, so it can't be changed. Start a new ticket instead.`;
    case "ticket_cancelled":
      return `${ticket} was cancelled. Start a new ticket instead.`;
    case "stale_ticket":
      return "Someone else just changed this ticket. The page shows their version now; make your change again.";
    case "menu_item_not_found":
      return "An item is no longer on the menu. The page has been refreshed.";
    case "item_unavailable":
      return `${detail ?? "An item"} is turned off right now. Remove it and save again.`;
    default:
      return "The ticket couldn't be saved. Check the connection and try again.";
  }
}

/** Refusals that mean the screen is out of date and should reload what's saved. */
export function shouldReload(error: DbError): boolean {
  return [
    "visit_not_found",
    "visit_closed",
    "ticket_not_found",
    "ticket_printed",
    "ticket_cancelled",
    "stale_ticket",
    "menu_item_not_found",
  ].includes(error.message ?? "");
}
