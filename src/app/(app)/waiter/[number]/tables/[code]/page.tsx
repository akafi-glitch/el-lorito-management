import type { Metadata } from "next";
import Link from "next/link";

import { SectionShell } from "@/components/section-shell";
import { buttonClasses } from "@/components/ui/button";
import { allTables } from "@/features/floor/layout";
import { STATUS_LABEL } from "@/features/floor/status";
import { employeeLabel } from "@/features/staff/rules";
import { WaiterRefused } from "@/features/waiter/components/waiter-refused";
import { loadWaiterScreen } from "@/features/waiter/queries";
import { resolveWaiter } from "@/features/waiter/resolve";
import { crossSectionWarning, openTableProblem, tableAccess, tablePath, waiterPath } from "@/features/waiter/rules";
import { tableCodeSchema } from "@/features/waiter/schema";

export const metadata: Metadata = { title: "Table" };

type Props = {
  params: Promise<{ number: string; code: string }>;
  searchParams: Promise<{ continue?: string | string[] }>;
};

export default async function WaiterTablePage({ params, searchParams }: Props) {
  const [{ number, code }, query] = await Promise.all([params, searchParams]);
  const result = await resolveWaiter(number);
  const shell = (title: string, children: React.ReactNode) => (
    <SectionShell title={title} description="Waiter Section">
      {children}
    </SectionShell>
  );

  if (!result.ok) return shell("Waiter Section", <WaiterRefused message={result.message} />);
  const me = result.employee;
  const back = waiterPath(me);

  const parsedCode = tableCodeSchema.safeParse(code);
  const { floor, waiters } = await loadWaiterScreen(me);
  const table = parsedCode.success ? allTables(floor).find((t) => t.code === parsedCode.data) : undefined;

  const backLink = (
    <Link href={back} className={buttonClasses("secondary")}>
      Back to your tables
    </Link>
  );

  if (!table) {
    return shell("Table not found", <Problem message="That table isn't on the floor plan." action={backLink} />);
  }

  const problem = openTableProblem(table);
  if (problem) return shell(table.label, <Problem message={problem} action={backLink} />);

  // Someone opened this link without confirming (or typed it): ask here too.
  const warning = crossSectionWarning(tableAccess(table, me, waiters));
  if (warning && query.continue !== "1") {
    return shell(
      `Open ${table.label}?`,
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <p className="text-lg text-ink">{warning}</p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {backLink}
          <Link href={tablePath(back, table, true)} className={buttonClasses("primary")}>
            Continue
          </Link>
        </div>
      </div>,
    );
  }

  const visit = table.visit!;
  const guests = visit.guestCount === 1 ? "1 guest" : `${visit.guestCount} guests`;

  return shell(
    `Table ${visit.tableLabels.join(" + ")}`,
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 rounded-2xl border border-glaze bg-paper p-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm font-semibold text-muted">Waiter</dt>
          <dd className="text-xl font-bold text-ink">{employeeLabel(me)}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">Guests</dt>
          <dd className="text-xl font-bold text-ink">{guests}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">Status</dt>
          <dd className="text-xl font-bold text-ink">{STATUS_LABEL[table.status]}</dd>
        </div>
      </dl>
      {warning ? (
        <p className="rounded-xl border-2 border-status-chips bg-status-chips/20 px-4 py-3 text-base font-semibold text-ink">
          You confirmed opening a table outside your section. Tickets you create here will carry your name.
        </p>
      ) : null}
      <div className="rounded-2xl border-2 border-dashed border-glaze bg-paper p-6">
        <p className="text-lg font-semibold text-ink">The menu and tickets aren&apos;t built yet.</p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-base text-muted">
          <li>Phases 6 and 7: menu and orders for this table</li>
          <li>Phase 8: taxes and the combined bill</li>
          <li>Phase 9: printing the ticket</li>
        </ul>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {backLink}
        <Link href="/" className={buttonClasses("primary")}>
          Done: back to Home
        </Link>
      </div>
    </div>,
  );
}

function Problem({ message, action }: { message: string; action: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
        {message}
      </p>
      {action}
    </div>
  );
}
