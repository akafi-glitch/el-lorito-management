import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { SignOutButton } from "@/features/auth/sign-out-button";

type TopBarProps = { displayName: string; showWordmark?: boolean };

/** Slim bar on every signed-in page: who is signed in on this device, and sign out. */
export function TopBar({ displayName, showWordmark = true }: TopBarProps) {
  // On the home page the bar sits on the tile pattern, so it has no background of its own.
  return (
    <header className={showWordmark ? "bg-cobalt-deep" : ""}>
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {showWordmark ? (
          <Link href="/" className="rounded-md py-2" aria-label="El Lorito home">
            <Wordmark size="small" />
          </Link>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-sm text-white/80 sm:inline">
            Signed in as <span className="font-semibold text-white">{displayName}</span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
