import { buttonClasses } from "@/components/ui/button";

import { signOut } from "./actions";

type SignOutButtonProps = { tone?: "on-dark" | "on-light" };

export function SignOutButton({ tone = "on-dark" }: SignOutButtonProps) {
  return (
    <form action={signOut}>
      <button type="submit" className={buttonClasses(tone === "on-dark" ? "quiet" : "secondary", "min-h-11 px-4")}>
        Sign out
      </button>
    </form>
  );
}
