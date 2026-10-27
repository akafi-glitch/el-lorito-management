"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { holdRefresh } from "@/features/sync/hold";

import { printTicketAction, recordPrintOutcomeAction, reprintTicketAction, type PrintResult } from "../actions";
import type { ReceiptData } from "../receipt";

import { Receipt } from "./receipt";

/** What the first print needs: a saved ticket at its current version. */
export type PrintTarget = { visitId: number; ticketId: number; version: number; ticketNumber: number };

type PrintFlowProps = {
  employeeNumber: string;
  paperWidthMm: 58 | 80;
  /** "first": save if needed, lock, print. "reprint": another copy of a printed ticket. */
  mode: { kind: "first"; prepare: () => Promise<PrintTarget | null> } | { kind: "reprint"; ticketId: number; ticketNumber: number };
  label: string;
  disabled?: boolean;
  className?: string;
  onError: (message: string) => void;
  /** Where to go after "Back to the ticket" (the page then shows the printed, locked ticket). */
  ticketHref: (ticketNumber: number) => string;
};

type Phase =
  | { name: "idle" }
  | { name: "working" }
  | { name: "printing"; receipt: ReceiptData; attemptId: number; ticketId: number }
  | { name: "asking"; receipt: ReceiptData; attemptId: number; ticketId: number }
  | { name: "failed"; receipt: ReceiptData; ticketId: number };

const OFFLINE = "Couldn't reach the server, so nothing was printed. Check the connection and try again.";

/**
 * The print workflow: the database records the print first (and locks the ticket the first time),
 * then the browser's print dialog opens, then the waiter says whether paper came out. "Yes" goes
 * back to the home page; "No" offers to print again. Nothing claims a ticket printed by itself.
 */
export function PrintFlow({ employeeNumber, paperWidthMm, mode, label, disabled, className, onError, ticketHref }: PrintFlowProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [answering, setAnswering] = useState(false);

  // Live updates wait while printing is in progress, so the question can't be swapped away.
  const busyPrinting = phase.name !== "idle";
  useEffect(() => {
    if (!busyPrinting) return;
    return holdRefresh();
  }, [busyPrinting]);

  // Once the receipt is on the page, open the print dialog (it blocks until closed), then ask.
  useEffect(() => {
    if (phase.name !== "printing") return;
    const frame = requestAnimationFrame(() => {
      window.print();
      setPhase({ name: "asking", receipt: phase.receipt, attemptId: phase.attemptId, ticketId: phase.ticketId });
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  function show(result: PrintResult, ticketId: number) {
    if (result.ok) setPhase({ name: "printing", receipt: result.receipt, attemptId: result.attemptId, ticketId });
    else {
      setPhase({ name: "idle" });
      onError(result.message);
    }
  }

  async function start() {
    setPhase({ name: "working" });
    try {
      if (mode.kind === "reprint") {
        show(await reprintTicketAction({ employeeNumber, ticketId: mode.ticketId }), mode.ticketId);
        return;
      }
      const target = await mode.prepare();
      if (!target) {
        setPhase({ name: "idle" });
        return;
      }
      show(
        await printTicketAction({ employeeNumber, visitId: target.visitId, ticketId: target.ticketId, version: target.version }),
        target.ticketId,
      );
    } catch {
      setPhase({ name: "idle" });
      onError(OFFLINE);
    }
  }

  async function printAgain(ticketId: number) {
    setPhase({ name: "working" });
    try {
      show(await reprintTicketAction({ employeeNumber, ticketId }), ticketId);
    } catch {
      setPhase({ name: "idle" });
      onError(OFFLINE);
      router.refresh();
    }
  }

  async function answer(printed: boolean) {
    if (phase.name !== "asking") return;
    setAnswering(true);
    try {
      const result = await recordPrintOutcomeAction({ employeeNumber, attemptId: phase.attemptId, printed });
      if (!result.ok) onError(result.message);
    } catch {
      onError("Couldn't save your answer (no connection). The ticket itself is saved and locked.");
    } finally {
      setAnswering(false);
    }
    if (printed) {
      router.push("/"); // the print workflow ends on the home page
      return;
    }
    setPhase({ name: "failed", receipt: phase.receipt, ticketId: phase.ticketId });
  }

  function backToTicket(ticketNumber: number) {
    setPhase({ name: "idle" });
    router.replace(ticketHref(ticketNumber));
    router.refresh();
  }

  const receipt = phase.name === "printing" || phase.name === "asking" || phase.name === "failed" ? phase.receipt : null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || phase.name !== "idle"}
        onClick={start}
        className={className ?? buttonClasses("primary", "min-h-14 w-full text-lg")}
      >
        {phase.name === "working" ? "Preparing the ticket…" : label}
      </button>

      {receipt && phase.name !== "failed" ? <Receipt receipt={receipt} paperWidthMm={paperWidthMm} /> : null}

      {phase.name === "asking" ? (
        <Modal title={`Did ticket #${phase.receipt.ticketNumber} print?`} onClose={() => backToTicket(phase.receipt.ticketNumber)}>
          <p className="text-lg text-ink">Check the printer. Answer Yes only if the paper came out.</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={answering} className={buttonClasses("secondary")} onClick={() => answer(false)}>
              No, it didn&apos;t print
            </button>
            <button type="button" disabled={answering} className={buttonClasses("primary")} onClick={() => answer(true)}>
              Yes, it printed
            </button>
          </div>
        </Modal>
      ) : null}

      {phase.name === "failed" ? (
        <Modal title={`Ticket #${phase.receipt.ticketNumber} didn't print`} onClose={() => backToTicket(phase.receipt.ticketNumber)}>
          <p className="text-lg text-ink">
            Check the printer&apos;s paper and power, then print again. The ticket is saved and can&apos;t be changed.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={() => backToTicket(phase.receipt.ticketNumber)}>
              Back to the ticket
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={() => printAgain(phase.ticketId)}>
              Print again
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
