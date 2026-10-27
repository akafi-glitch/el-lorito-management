/** Database refusals for staff changes, in plain words. */

type DbError = { code?: string | null; message?: string | null; details?: string | null };

export function staffErrorMessage(error: DbError): string {
  const detail = error.details?.trim() || null;
  switch (error.message) {
    case "no_open_shift":
      return "Start a shift first, then assign staff.";
    case "section_not_found":
      return "That section isn't on the floor plan.";
    case "bar_open_to_all":
      return "The Bar has no assigned waiter: any waiter can bill it.";
    case "employee_not_found":
      return "That employee no longer exists. The page has been refreshed.";
    case "employee_inactive":
      return `${detail ?? "That employee"} is turned off. Turn them on first.`;
    case "role_mismatch":
      return `${detail ?? "That employee"} can't take this duty. Waiters wait tables, chips runners run chips, managers can do both.`;
    case "employee_number_taken":
      return `That number is already used by ${detail ?? "another employee"}. (01 and 1 count as the same number.)`;
    default:
      if (error.code === "23505") return "That was just changed on another device. The page has been refreshed.";
      if (error.code === "23514") return "Check the details: numbers are digits only and names can't be blank.";
      return "The change couldn't be saved. Check the connection and try again.";
  }
}

/** Supabase Auth refusals when adding an account or setting a password. */
export function accountErrorMessage(error: { code?: string | null; message?: string | null; status?: number }): string {
  const code = error.code ?? "";
  const text = (error.message ?? "").toLowerCase();
  if (code === "email_exists" || code === "user_already_exists" || text.includes("already been registered")) {
    return "That username is already used.";
  }
  if (code === "weak_password" || text.includes("password")) {
    return "That password is too weak. Use at least 10 characters.";
  }
  if (error.status === 429) return "Too many changes at once. Wait a minute, then try again.";
  return "The account couldn't be saved. Check the connection and try again.";
}
