"use client";

import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { holdRefresh } from "@/features/sync/hold";

import { recordPrintOutcomeAction } from "../actions";
import type { KitchenReceiptData, ReceiptData } from "../receipt";

import { KitchenReceipts, Receipt } from "./receipt";

/** A print the database has recorded, ready for the printer. */
export type PrintJob = {
  attemptIds: number[];
  content: { kind: "kitchen"; receipts: KitchenReceiptData[] } | { kind: "customer"; receipt: ReceiptData; isCopy: boolean };
};

export type PrintStart = { job: PrintJob } | { message: string };

type PrintFlowProps = {
  employeeNumber: string;
  paperWidthMm: 58 | 80;
  label: string;
  disabled?: boolean;
  className?: string;
  /** Records the print (saving first if needed) and returns what to print. Null: the caller has said why not. */
  start: () => Promise<PrintStart | null>;
  onError: (message: string) => void;
  /** Printing is over. printed is false when it couldn't be saved. */
  onDone: (printed: boolean) => void;
};

type Phase = { name: "idle" } | { name: "working" } | { name: "printing"; job: PrintJob };

const OFFLINE = "Couldn't reach the server, so nothing was printed. Check the connection and try again.";
const NOT_SAVED = "It went to the printer, but couldn't be saved (no connection). Check the connection and print it again.";
/** A phone's print() returns before its dialog is done: the receipt stays on the page at least this long. */
const KEEP_RECEIPT_MS = 1500;

function printDialogClosed(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, KEEP_RECEIPT_MS);
    window.addEventListener(
      "afterprint",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * The print workflow (owner decision, Nov 4, 2026): the database records the print first, the browser's print
 * dialog opens, and the print is saved as done with no question. The browser can't tell whether paper came out,
 * so anything that didn't print is simply printed again.
 */
export function PrintFlow({ employeeNumber, paperWidthMm, label, disabled, className, start, onError, onDone }: PrintFlowProps) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  // Live updates wait while printing, so the receipt isn't swapped away from under the printer.
  const busyPrinting = phase.name !== "idle";
  useEffect(() => {
    if (!busyPrinting) return;
    return holdRefresh();
  }, [busyPrinting]);

  // Once the receipt is on the page, open the print dialog (it blocks until closed), then save.
  useEffect(() => {
    if (phase.name !== "printing") return;
    const { attemptIds } = phase.job;
    const frame = requestAnimationFrame(() => {
      const closed = printDialogClosed();
      window.print();
      void (async () => {
        let printed = false;
        try {
          const result = await recordPrintOutcomeAction({ employeeNumber, attemptIds, printed: true });
          printed = result.ok;
          if (!result.ok) onError(result.message);
        } catch {
          onError(NOT_SAVED);
        }
        await closed;
        setPhase({ name: "idle" });
        onDone(printed);
      })();
    });
    return () => cancelAnimationFrame(frame);
    // Runs once per print: the callbacks may change identity while it is under way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function begin() {
    setPhase({ name: "working" });
    try {
      const result = await start();
      if (result === null) {
        setPhase({ name: "idle" });
      } else if ("job" in result) {
        setPhase({ name: "printing", job: result.job });
      } else {
        setPhase({ name: "idle" });
        onError(result.message);
      }
    } catch {
      setPhase({ name: "idle" });
      onError(OFFLINE);
    }
  }

  const job = phase.name === "printing" ? phase.job : null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || phase.name !== "idle"}
        onClick={begin}
        className={className ?? buttonClasses("primary", "min-h-14 w-full text-lg")}
      >
        {phase.name === "working" ? "Preparing…" : phase.name === "printing" ? "Printing…" : label}
      </button>

      {job?.content.kind === "kitchen" ? <KitchenReceipts receipts={job.content.receipts} paperWidthMm={paperWidthMm} /> : null}
      {job?.content.kind === "customer" ? <Receipt receipt={job.content.receipt} isCopy={job.content.isCopy} paperWidthMm={paperWidthMm} /> : null}
    </>
  );
}
