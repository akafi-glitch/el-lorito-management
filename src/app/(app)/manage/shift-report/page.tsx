import type { Metadata } from "next";
import Link from "next/link";

import { PrintShiftReport, ShiftReportPicker } from "@/features/history/components/shift-report-actions";
import { loadShiftChoices, loadShiftReport } from "@/features/history/queries";
import { chooseShift, openTicketsText } from "@/features/history/shift-report";
import { formatCents } from "@/features/menu/money";
import { LiveSync } from "@/features/sync/components/live-sync";
import { loadVersions } from "@/features/sync/queries";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Shift Report" };

type Props = { searchParams: Promise<{ shift?: string | string[] }> };

/** One shift's sales: ticket numbers and totals, the shift total, and a print button. */
export default async function ShiftReportPage({ searchParams }: Props) {
  const asked = (await searchParams).shift;
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const shifts = await loadShiftChoices();
  const shift = chooseShift(shifts, asked);
  const report = shift ? await loadShiftReport(shift.id) : null;

  return (
    <section aria-labelledby="report-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="report-heading" className="text-xl font-bold text-ink">
          Shift Report
        </h2>
        <LiveSync watch={["tickets", "staff"]} versions={versions} />
      </div>

      {!shift || !report ? (
        <p className="rounded-2xl border border-glaze bg-paper p-5 text-base text-ink">No shifts yet.</p>
      ) : (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
          <ShiftReportPicker shifts={shifts} selected={shift.id} />

          <div className="rounded-2xl border border-glaze bg-paper p-5">
            <p className="text-sm font-semibold text-muted">Shift total ({report.lines.length === 1 ? "1 ticket" : `${report.lines.length} tickets`})</p>
            <p className="text-4xl font-bold tabular-nums text-ink" data-testid="shift-total">
              {formatCents(report.totalCents)}
            </p>
            <p className="mt-1 text-sm text-muted">{shift.ended ? `Ended ${shift.ended}` : "This shift is still open, so the total can still grow."}</p>
          </div>

          {report.openTickets.length > 0 ? (
            <p role="status" className="rounded-xl border-2 border-status-chips bg-paper px-4 py-3 text-base font-semibold text-ink" data-testid="open-tickets">
              Not included: {openTicketsText(report.openTickets)} still open, {formatCents(report.openCents)}. They count once the customer receipt is printed.
            </p>
          ) : null}

          <PrintShiftReport shift={shift} report={report} paperWidthMm={serverEnv().RECEIPT_PAPER_WIDTH_MM} timeZone={serverEnv().APP_TIME_ZONE} />

          {report.lines.length === 0 ? (
            <p className="rounded-2xl border border-glaze bg-paper p-5 text-base text-ink">No customer receipts were printed in this shift.</p>
          ) : (
            <div className="rounded-2xl border border-glaze bg-paper">
              <table className="w-full text-left text-base">
                <thead className="border-b border-glaze text-sm text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Ticket</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glaze">
                  {report.lines.map((line) => (
                    <tr key={line.ticketNumber} className="text-ink" data-testid="report-row">
                      <td className="px-4 py-1 font-bold">
                        <Link href={`/manage/history/${line.ticketNumber}`} className="inline-flex min-h-11 min-w-11 items-center text-leaf underline">
                          #{line.ticketNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-1 text-right font-semibold tabular-nums">{formatCents(line.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
