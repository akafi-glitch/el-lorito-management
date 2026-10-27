import Link from "next/link";

import { TopBar } from "@/components/top-bar";
import { Wordmark } from "@/components/wordmark";
import { managementDestination, primaryDestinations } from "@/config/navigation";
import { getSessionState } from "@/features/auth/session";

export default async function HomePage() {
  const session = await getSessionState();
  const displayName = session.status === "signed-in" ? session.user.displayName : "";

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="tile-pattern">
        <TopBar displayName={displayName} showWordmark={false} />
        <section className="px-4 pb-16 pt-8 sm:pb-24 sm:pt-12">
          <h1>
            <Wordmark />
          </h1>
        </section>
      </div>

      <main className="mx-auto -mt-10 w-full max-w-4xl flex-1 px-4 pb-12 sm:-mt-14 sm:px-6">
        <nav aria-label="Main sections" className="grid gap-4 sm:grid-cols-2">
          {primaryDestinations.map((destination) => (
            <Link
              key={destination.href}
              href={destination.href}
              className="flex min-h-36 flex-col gap-3 rounded-2xl border-2 border-glaze bg-paper p-6 shadow-[0_2px_0_var(--color-glaze)] transition-colors hover:border-cobalt sm:min-h-48 sm:p-8"
            >
              <span className="text-2xl font-bold text-cobalt sm:text-3xl">{destination.label}</span>
              <span className="text-base text-muted sm:text-lg">{destination.description}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-8 flex justify-center">
          <Link
            href={managementDestination.href}
            className="inline-flex min-h-12 items-center rounded-lg px-5 font-semibold text-cobalt underline-offset-4 hover:underline"
          >
            {managementDestination.label}: {managementDestination.description.toLowerCase()}
          </Link>
        </div>
      </main>
    </div>
  );
}
