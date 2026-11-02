"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { buttonClasses } from "@/components/ui/button";
import { formatCents } from "@/features/menu/money";
import { PageRule, paperStyle, ReceiptRow } from "@/features/printing/components/receipt";
import { RESTAURANT } from "@/features/printing/receipt";

import { openTicketsText, type ShiftChoice, type ShiftReport } from "../shift-report";

/** Which shift to read. Changing it opens that shift's report. */
export function ShiftReportPicker({ shifts, selected }: { shifts: ShiftChoice[]; selected: number }) {
  const router = useRouter();
  const [loading, startLoading] = useTransition();
  return (
    <div className="flex flex-col gap-1" aria-busy={loading}>
      <label htmlFor="report-shift" className="text-sm font-semibold text-ink">
        Shift
      </label>
      <select
        id="report-shift"
        value={selected}
        onChange={(event) => startLoading(() => router.push(`/manage/shift-report?shift=${event.target.value}`))}
        className="min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none"
      >
        {shifts.map((shift) => (
          <option key={shift.id} value={shift.id}>
            {shift.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Prints the report on the receipt printer. Like a receipt, it goes straight under <body> and is the
 * only thing on the page when printing. Reading a report changes nothing, so no answer is asked for.
 */
export function PrintShiftReport({
  shift,
  report,
  paperWidthMm,
  timeZone,
}: {
  shift: ShiftChoice;
  report: ShiftReport;
  paperWidthMm: 58 | 80;
  timeZone: string;
}) {
  const [printedAt, setPrintedAt] = useState<string | null>(null);

  useEffect(() => {
    if (printedAt === null) return;
    const frame = requestAnimationFrame(() => {
      window.print();
      setPrintedAt(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [printedAt]);

  function print() {
    setPrintedAt(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" })
        .format(new Date())
        .replace(",", ""),
    );
  }

  return (
    <>
      <button type="button" disabled={report.lines.length === 0 || printedAt !== null} onClick={print} className={buttonClasses("primary", "min-h-14 w-full text-lg sm:w-auto")}>
        Print Shift Report
      </button>
      {printedAt === null
        ? null
        : createPortal(
            <div className="receipt-print" data-testid="shift-report-print" style={paperStyle(paperWidthMm)}>
              <PageRule paperWidthMm={paperWidthMm} />
              <div className="receipt-center">
                <div className="receipt-title">{RESTAURANT.name}</div>
                <div>SHIFT REPORT</div>
              </div>
              <hr />
              <div>STARTED: {shift.started}</div>
              <div>ENDED: {shift.ended ?? "Still open"}</div>
              <div>PRINTED: {printedAt}</div>
              <hr />
              <ReceiptRow left="TICKET" right="TOTAL" />
              {report.lines.map((line) => (
                <ReceiptRow key={line.ticketNumber} left={`#${line.ticketNumber}`} right={formatCents(line.totalCents)} />
              ))}
              <hr />
              <div>TICKETS: {report.lines.length}</div>
              <div className="receipt-total">
                <ReceiptRow left="SHIFT TOTAL" right={formatCents(report.totalCents)} />
              </div>
              {report.openTickets.length > 0 ? (
                <>
                  <hr />
                  <div>NOT INCLUDED, STILL OPEN:</div>
                  <div>
                    {openTicketsText(report.openTickets)}: {formatCents(report.openCents)}
                  </div>
                </>
              ) : null}
            </div>,
            document.body,
          )}
    </>
  );
}
