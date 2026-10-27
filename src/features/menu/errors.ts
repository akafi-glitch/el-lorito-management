type DbError = { code?: string | null; message?: string | null };

export function menuErrorMessage(error: DbError): string {
  if (error.message === "menu_item_not_found") return "That item no longer exists. The page has been refreshed.";
  if (error.code === "23514") return "That price isn't allowed. Enter a price from $0.00 to $10,000.";
  return "The change couldn't be saved. Check the connection and try again.";
}
