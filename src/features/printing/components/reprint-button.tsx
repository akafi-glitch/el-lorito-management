"use client";

import { useState } from "react";

import { withTicket } from "@/features/tickets/rules";

import { PrintFlow } from "./print-flow";

/** "Print again" on a printed ticket, with its own error message. */
export function ReprintButton({
  employeeNumber,
  paperWidthMm,
  ticketId,
  ticketNumber,
  tableHref,
}: {
  employeeNumber: string;
  paperWidthMm: 58 | 80;
  ticketId: number;
  ticketNumber: number;
  tableHref: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <PrintFlow
        employeeNumber={employeeNumber}
        paperWidthMm={paperWidthMm}
        mode={{ kind: "reprint", ticketId, ticketNumber }}
        label="Print again"
        onError={setError}
        ticketHref={(number) => withTicket(tableHref, number)}
      />
    </div>
  );
}
