import { RESTAURANT_CLOSED_TEXT } from "@/features/waiter/rules";

type DbError = { code?: string | null; message?: string | null; details?: string | null };

/** Database refusals for tickets, in plain words. */
export function ticketErrorMessage(error: DbError): string {
  const detail = error.details?.trim() || null;
  const ticket = detail ? `Ticket #${detail}` : "This ticket";
  switch (error.message) {
    case "restaurant_closed":
      return RESTAURANT_CLOSED_TEXT;
    case "to_go_full":
      return "All 30 to-go spots have an open order. Finish or cancel one first.";
    case "manager_approval_required":
      return "The kitchen already has this order, so a manager's PIN is needed to take anything off it. The page has been refreshed.";
    case "pin_not_allowed":
      return "That manager can't approve this. Ask another manager.";
    case "empty_ticket":
      return "Add at least one item before saving.";
    case "invalid_lines":
      return "The order couldn't be read. Reload the page and try again.";
    case "employee_not_found":
      return "Your employee number wasn't found. Enter it again.";
    case "employee_inactive":
      return `${detail ?? "This employee"} is turned off and can't save tickets. Ask a manager.`;
    case "table_not_found":
      return "That table isn't on the floor plan. The page has been refreshed.";
    case "visit_not_found":
    case "visit_closed":
      return "This table has been cleared, so its tickets can't be changed. The page has been refreshed.";
    case "ticket_not_found":
      return "That ticket isn't on this table. The page has been refreshed.";
    case "ticket_finalized":
      return `${ticket} is finalized: the customer receipt was printed, so nothing more can be added or changed.`;
    case "order_full":
      return "This order can't take that much more before the kitchen gets it. Print the kitchen receipt first, then add the rest.";
    case "invalid_custom_item":
      return "Check the custom item: it needs a name, a price of $0.00 or more, and a tax type.";
    case "invalid_notes":
      return "That note is too long. Use 500 characters or fewer.";
    case "invalid_changes":
    case "missing_client_key":
      return "The order couldn't be read. Reload the page and try again.";
    case "line_not_found":
    case "batch_not_found":
      return "That item is no longer on this ticket. The page has been refreshed.";
    case "ticket_printed":
      return `${ticket} is printed, so it can't be changed. Start a new ticket instead.`;
    case "ticket_cancelled":
      return `${ticket} was cancelled. Start a new ticket instead.`;
    case "stale_ticket":
      return "Someone else just changed this ticket. The page shows the latest version now; make your change again.";
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
    "restaurant_closed",
    "manager_approval_required",
    "table_not_found",
    "visit_not_found",
    "visit_closed",
    "ticket_not_found",
    "ticket_printed",
    "ticket_finalized",
    "line_not_found",
    "batch_not_found",
    "ticket_cancelled",
    "stale_ticket",
    "menu_item_not_found",
  ].includes(error.message ?? "");
}
