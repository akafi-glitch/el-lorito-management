import { redirect } from "next/navigation";

import { Wordmark } from "@/components/wordmark";
import { getSessionState } from "@/features/auth/session";
import { SignOutButton } from "@/features/auth/sign-out-button";

// Every page in this group needs a signed-in, active administrator.
export const dynamic = "force-dynamic";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionState();

  if (session.status === "signed-out") redirect("/sign-in");

  if (session.status === "inactive" || session.status === "unknown-account") {
    const message =
      session.status === "inactive"
        ? "This account is turned off. Ask an administrator to turn it back on."
        : "This sign-in isn't linked to an El Lorito account. Ask an administrator to add it.";
    return (
      <main className="tile-pattern flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-paper p-8 text-center">
          <div className="-mx-8 -mt-8 mb-6 rounded-t-2xl bg-leaf-light px-8 py-6">
            <Wordmark size="small" />
          </div>
          <p className="text-lg text-ink">{message}</p>
          <div className="mt-6 flex justify-center">
            <SignOutButton tone="on-light" />
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
