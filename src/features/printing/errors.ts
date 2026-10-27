import { ticketErrorMessage } from "@/features/tickets/errors";

type DbError = { code?: string | null; message?: string | null; details?: string | null };

/** Printing refusals in plain words (ticket refusals are shared with saving). */
export function printErrorMessage(error: DbError): string {
  switch (error.message) {
    case "ticket_printed":
      return "This ticket is already printed. Use Print again for another copy.";
    case "ticket_not_printed":
      return "This ticket hasn't been printed yet, so it can't be printed again.";
    case "print_attempt_not_found":
      return "That print couldn't be found. The page has been refreshed.";
    case "outcome_already_recorded":
      return "The answer for that print was already saved.";
    case "empty_ticket":
      return "Add at least one item before printing.";
    case "invalid_outcome":
      return "Answer Yes or No.";
    default: {
      const message = ticketErrorMessage(error);
      return message === "The ticket couldn't be saved. Check the connection and try again."
        ? "Couldn't reach the server, so nothing was printed. Check the connection and try again."
        : message;
    }
  }
}
