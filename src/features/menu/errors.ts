type DbError = { code?: string | null; message?: string | null };

export function menuErrorMessage(error: DbError): string {
  if (error.message === "menu_item_not_found") return "That item no longer exists. The page has been refreshed.";
  if (error.message === "category_not_found") return "That menu page no longer exists. The page has been refreshed.";
  if (error.message === "name_taken") return "That page already has an item with that name. Choose another name.";
  if (error.message === "option_taken") return "That item already has that option.";
  if (error.message === "invalid_name") return "Enter a name of 1 to 80 characters (with its options' names, 80 at most).";
  if (error.message === "invalid_description") return "Keep the description to 400 characters.";
  if (error.message === "invalid_option") return "Enter an option of 1 to 40 characters, without brackets.";
  if (error.message === "invalid_tax_category") return "Choose the tax type.";
  if (error.code === "23514") return "That price isn't allowed. Enter a price from $0.00 to $10,000.";
  return "The change couldn't be saved. Check the connection and try again.";
}
