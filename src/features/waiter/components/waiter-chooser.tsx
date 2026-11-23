import Link from "next/link";

import type { EmployeeRef } from "@/features/staff/rules";

import { chooserColumns, UPRIGHT, waiterPath } from "../rules";
import { NumberPad } from "./number-pad";

const headerLink =
  "inline-flex min-h-12 cursor-pointer items-center rounded-lg border border-glaze bg-paper px-4 text-base font-semibold text-leaf hover:border-leaf";

type WaiterHeaderProps = {
  /** The page's one heading: "Who are you?", or "Waiter Section" while closed. */
  title: string;
  live: React.ReactNode;
  /** Beside Home, on the right. */
  actions?: React.ReactNode;
};

/** One slim line at the top: Waiter Section and live status, the heading in the middle, then Home. */
export function WaiterHeader({ title, live, actions }: WaiterHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-2 border-b border-glaze pb-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
      <div className="flex items-center gap-3 justify-self-start">
        <p className="whitespace-nowrap text-base font-semibold text-muted">Waiter Section</p>
        {live}
      </div>
      <h1 id="who-heading" className="text-center text-3xl font-bold text-ink lg:text-4xl">
        {title}
      </h1>
      <div className="flex items-center gap-2 justify-self-end">
        {actions}
        <Link href="/" className={headerLink}>
          Home
        </Link>
      </div>
    </header>
  );
}

/**
 * "Who are you?" (owner decisions, Nov 22, 2026): every active waiter is a big box to tap, and on a laptop or iPad
 * (sideways or upright) they all fit on one screen, the boxes growing to fill it. Anyone not on the list (a manager,
 * say) opens the number pad from the top line.
 */
export function WaiterChooser({ waiters, live }: { waiters: readonly Pick<EmployeeRef, "number" | "name">[]; live: React.ReactNode }) {
  const columns = chooserColumns(waiters.length);
  const uprightColumns = chooserColumns(waiters.length, UPRIGHT);

  return (
    <div data-testid="who-are-you" className="flex min-h-0 flex-1 flex-col gap-3">
      <WaiterHeader
        title="Who are you?"
        live={live}
        actions={
          <details className="relative">
            <summary className={`${headerLink} list-none [&::-webkit-details-marker]:hidden`}>Not on the list? Enter your number</summary>
            <div className="absolute right-0 top-full z-20 mt-2 w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border-2 border-glaze bg-paper p-4 shadow-xl">
              <NumberPad />
            </div>
          </details>
        }
      />

      {waiters.length === 0 ? (
        <p className="mx-auto mt-6 max-w-md rounded-xl border-2 border-glaze bg-paper px-4 py-6 text-center text-lg font-semibold text-ink">
          No waiters are set up yet. A manager adds them under Manage, Employees.
        </p>
      ) : (
        <nav aria-labelledby="who-heading" className="flex min-h-0 flex-1 flex-col">
          <ul
            style={{ "--cols": columns, "--cols-upright": uprightColumns } as React.CSSProperties}
            className="grid flex-1 auto-rows-[8rem] grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 md:min-h-0 md:auto-rows-fr md:grid-cols-[repeat(var(--cols),minmax(0,1fr))] md:overflow-y-auto md:p-0.5 md:portrait:grid-cols-[repeat(var(--cols-upright),minmax(0,1fr))] lg:gap-4"
          >
            {waiters.map((waiter) => (
              <li key={waiter.number} className="min-h-0">
                <Link
                  href={waiterPath(waiter)}
                  aria-label={`${waiter.name} (${waiter.number})`}
                  className="flex h-full flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-glaze bg-paper p-3 text-center shadow-sm hover:border-leaf active:scale-[0.98] lg:gap-2"
                >
                  <span
                    className={`font-bold leading-none tabular-nums text-leaf ${waiter.number.length > 3 ? "text-3xl md:text-4xl lg:text-5xl" : "text-4xl md:text-5xl lg:text-6xl"}`}
                  >
                    {waiter.number}
                  </span>
                  <span className="max-w-full break-words text-2xl font-bold leading-tight text-ink md:text-3xl xl:text-4xl">{waiter.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
