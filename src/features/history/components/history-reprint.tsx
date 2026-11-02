"use client";

import { useState } from "react";

import { ReprintButton } from "@/features/printing/components/reprint-button";
import { cleanTypedNumber } from "@/features/waiter/rules";

/** A copy from the history: every print records who asked for it, so it asks for the employee number. */
export function HistoryReprint({ ticketId, paperWidthMm }: { ticketId: number; paperWidthMm: 58 | 80 }) {
  const [number, setNumber] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reprint-number" className="text-sm font-semibold text-ink">
          Your employee number
        </label>
        <input
          id="reprint-number"
          inputMode="numeric"
          autoComplete="off"
          value={number}
          onChange={(event) => setNumber(cleanTypedNumber(event.target.value))}
          className="min-h-12 rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none"
        />
      </div>
      <ReprintButton employeeNumber={number} paperWidthMm={paperWidthMm} ticketId={ticketId} disabled={number === ""} />
    </div>
  );
}
