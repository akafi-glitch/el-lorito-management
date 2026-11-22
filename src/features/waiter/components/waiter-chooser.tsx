import Link from "next/link";

import type { EmployeeRef } from "@/features/staff/rules";

import { waiterPath } from "../rules";
import { NumberPad } from "./number-pad";

/**
 * "Who are you?" (owner decision, Nov 22, 2026): every active waiter is a big box to tap, filling the screen.
 * Anyone not on the list (a manager, say) can still type their number.
 */
export function WaiterChooser({ waiters }: { waiters: readonly Pick<EmployeeRef, "number" | "name">[] }) {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-labelledby="who-heading" data-testid="who-are-you" className="flex flex-col gap-4">
        <h2 id="who-heading" className="text-center text-3xl font-bold text-ink">
          Who are you?
        </h2>
        {waiters.length === 0 ? (
          <p className="mx-auto max-w-md rounded-xl border-2 border-glaze bg-paper px-4 py-6 text-center text-lg font-semibold text-ink">
            No waiters are set up yet. A manager adds them under Manage, Employees.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
            {waiters.map((waiter) => (
              <li key={waiter.number}>
                <Link
                  href={waiterPath(waiter)}
                  aria-label={`${waiter.name} (${waiter.number})`}
                  className="flex h-full min-h-32 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-glaze bg-paper p-4 text-center shadow-sm hover:border-leaf active:scale-[0.98] lg:min-h-40"
                >
                  <span className="text-4xl font-bold tabular-nums text-leaf">{waiter.number}</span>
                  <span className="text-2xl font-bold text-ink">{waiter.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <details className="mx-auto w-full max-w-sm">
        <summary className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-glaze bg-paper px-4 font-semibold text-leaf hover:border-leaf">
          Not on the list? Enter your number
        </summary>
        <div className="mt-4">
          <NumberPad />
        </div>
      </details>
    </div>
  );
}
