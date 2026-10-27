import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { SignOutButton } from "@/features/auth/sign-out-button";

type TopBarProps = { displayName: string; showWordmark?: boolean; wide?: boolean };

/** Slim bar on every signed-in page: who is signed in on this device, and sign out. */
export function TopBar({ displayName, showWordmark = true, wide = false }: TopBarProps) {
  // On the home page the bar sits on the tile pattern, so it has no background of its own.
  return (
    <header className={showWordmark ? "border-b border-glaze bg-leaf-light" : ""}>
      <div
        className={`mx-auto flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 ${wide ? "max-w-[96rem]" : "max-w-6xl"}`}
      >
        {showWordmark ? (
          <Link href="/" className="rounded-md py-2" aria-label="El Lorito home">
            <Wordmark size="small" />
          </Link>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-sm text-muted sm:inline">
            Signed in as <span className="font-semibold text-ink">{displayName}</span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
