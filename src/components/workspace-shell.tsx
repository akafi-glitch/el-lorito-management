import Link from "next/link";

import { LiveSync } from "@/features/sync/components/live-sync";
import type { Topic, Versions } from "@/features/sync/topics";

type WorkspaceShellProps = {
  /** "Kafi (01)": who is ordering. */
  waiter: string;
  /** "Table A1", "To-Go Order": the page's one heading. */
  title: string;
  /** Next to the title: the table's kitchen mark. */
  badge?: React.ReactNode;
  /** Where "Choose another table" goes. */
  backHref: string;
  live: { watch: readonly Topic[]; versions: Versions };
  children: React.ReactNode;
};

/**
 * Frame for the order screen (owner's sketch, Nov 22, 2026): the waiter and the table in one small line at the top,
 * and the rest of the screen for the menu and the ordered foods. On a laptop or iPad it fits the screen, and only
 * the parts inside scroll; on a phone the page scrolls as usual.
 */
export function WorkspaceShell({ waiter, title, badge, backHref, live, children }: WorkspaceShellProps) {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <main className="mx-auto flex min-h-0 w-full max-w-[112rem] flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-glaze pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-base text-muted">
              Waiter <span className="font-bold text-ink">{waiter}</span>
            </p>
            <span aria-hidden="true" className="text-glaze">
              |
            </span>
            <h1 className="text-xl font-bold text-ink">{title}</h1>
            {badge}
            <LiveSync watch={live.watch} versions={live.versions} />
          </div>
          <nav aria-label="Leave this table" className="flex gap-2">
            <Link
              href={backHref}
              className="inline-flex min-h-11 items-center rounded-lg border border-glaze bg-paper px-3 text-sm font-semibold text-leaf hover:border-leaf"
            >
              Choose another table
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-lg border border-glaze bg-paper px-3 text-sm font-semibold text-leaf hover:border-leaf"
            >
              Home
            </Link>
          </nav>
        </header>
        {children}
      </main>
    </div>
  );
}
