import type { Metadata } from "next";
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { HistoryFilterBar } from "@/features/history/components/history-filters";
import { loadHistory, loadShiftOptions } from "@/features/history/queries";
import { HISTORY_STATUS_TEXT, historyHref, parseHistoryFilters } from "@/features/history/rules";
import { formatCents } from "@/features/menu/money";
import { loadEmployees } from "@/features/staff/queries";
import { LiveSync } from "@/features/sync/components/live-sync";
import { loadVersions } from "@/features/sync/queries";

export const metadata: Metadata = { title: "Order History" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OrderHistoryPage({ searchParams }: Props) {
  const filters = parseHistoryFilters(await searchParams);
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const [history, shifts, employees] = await Promise.all([loadHistory(filters), loadShiftOptions(), loadEmployees()]);

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-heading" className="text-xl font-bold text-ink">
          Order History
        </h2>
        <LiveSync watch={["tickets", "staff"]} versions={versions} />
      </div>

      <HistoryFilterBar
        filters={filters}
        shifts={shifts}
        waiters={employees.map((employee) => ({ number: employee.number, name: employee.name }))}
      />

      {history.rows.length === 0 ? (
        <p className="rounded-2xl border border-glaze bg-paper p-5 text-base text-ink">No tickets match.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-glaze bg-paper">
          <table className="w-full min-w-[40rem] text-left text-base">
            <thead className="border-b border-glaze text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Ticket</th>
                <th scope="col" className="px-4 py-3 font-semibold">Date and time</th>
                <th scope="col" className="px-4 py-3 font-semibold">Shift started</th>
                <th scope="col" className="px-4 py-3 font-semibold">Waiter</th>
                <th scope="col" className="px-4 py-3 font-semibold">Table</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-glaze">
              {history.rows.map((row) => (
                <tr key={row.ticketNumber} className={row.status === "cancelled" ? "text-muted" : "text-ink"} data-testid="history-row">
                  <td className="px-4 py-1 font-bold">
                    <Link href={`/manage/history/${row.ticketNumber}`} className="inline-flex min-h-11 min-w-11 items-center text-leaf underline">
                      #{row.ticketNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-1">{row.time}</td>
                  <td className="px-4 py-1">{row.shift}</td>
                  <td className="px-4 py-1">{row.waiterNumber}</td>
                  <td className="px-4 py-1">{row.tables}</td>
                  <td className="px-4 py-1 text-right font-semibold tabular-nums">{formatCents(row.totalCents)}</td>
                  <td className="px-4 py-1">{HISTORY_STATUS_TEXT[row.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {filters.page > 1 ? (
          <Link href={historyHref({ ...filters, page: filters.page - 1 })} className={buttonClasses("secondary")}>
            Previous page
          </Link>
        ) : null}
        {history.hasMore ? (
          <Link href={historyHref({ ...filters, page: filters.page + 1 })} className={buttonClasses("secondary")}>
            Next page
          </Link>
        ) : null}
      </div>
    </section>
  );
}
