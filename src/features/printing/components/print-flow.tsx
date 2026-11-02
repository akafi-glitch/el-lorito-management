"use client";

import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { holdRefresh } from "@/features/sync/hold";

import { recordPrintOutcomeAction } from "../actions";
import type { KitchenReceiptData, ReceiptData } from "../receipt";

import { KitchenReceipts, Receipt } from "./receipt";

/** A print the database has recorded, ready for the dialog. */
export type PrintJob = {
  attemptIds: number[];
  /** "ticket #1042" or "order 2": named in the questions. */
  title: string;
  /** The question's extra sentence, for example what Yes will do. */
  question: string;
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
  /** The waiter answered, or left the question. printed is null when they left without answering. */
  onDone: (printed: boolean | null) => void;
};

type Phase =
  | { name: "idle" }
  | { name: "working" }
  | { name: "printing"; job: PrintJob }
  | { name: "asking"; job: PrintJob }
  | { name: "failed"; job: PrintJob };

const OFFLINE = "Couldn't reach the server, so nothing was printed. Check the connection and try again.";

/**
 * The print workflow: the database records the print first, then the browser's print dialog opens,
 * then the waiter says whether paper came out. Nothing claims a receipt printed by itself.
 */
export function PrintFlow({ employeeNumber, paperWidthMm, label, disabled, className, start, onError, onDone }: PrintFlowProps) {
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
      setPhase({ name: "asking", job: phase.job });
    });
    return () => cancelAnimationFrame(frame);
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

  async function answer(printed: boolean) {
    if (phase.name !== "asking") return;
    setAnswering(true);
    try {
      const result = await recordPrintOutcomeAction({ employeeNumber, attemptIds: phase.job.attemptIds, printed });
      if (!result.ok) {
        onError(result.message);
        setPhase({ name: "idle" });
        onDone(null);
        return;
      }
    } catch {
      onError("Couldn't save your answer (no connection). Nothing was finalized. Try again.");
      return;
    } finally {
      setAnswering(false);
    }
    if (printed) {
      setPhase({ name: "idle" });
      onDone(true);
    } else {
      setPhase({ name: "failed", job: phase.job });
    }
  }

  function leave(printed: boolean | null) {
    setPhase({ name: "idle" });
    onDone(printed);
  }

  const job = phase.name === "printing" || phase.name === "asking" ? phase.job : null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || phase.name !== "idle"}
        onClick={begin}
        className={className ?? buttonClasses("primary", "min-h-14 w-full text-lg")}
      >
        {phase.name === "working" ? "Preparing…" : label}
      </button>

      {job?.content.kind === "kitchen" ? <KitchenReceipts receipts={job.content.receipts} paperWidthMm={paperWidthMm} /> : null}
      {job?.content.kind === "customer" ? <Receipt receipt={job.content.receipt} isCopy={job.content.isCopy} paperWidthMm={paperWidthMm} /> : null}

      {phase.name === "asking" ? (
        <Modal title={`Did ${phase.job.title} print?`} onClose={() => leave(null)} keepOnOutsideTap>
          <p className="text-lg text-ink">Check the printer. Answer Yes only if the paper came out. {phase.job.question}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={answering} className={buttonClasses("secondary")} onClick={() => answer(false)}>
              No, it didn&apos;t print
            </button>
            <button type="button" disabled={answering} className={buttonClasses("primary")} onClick={() => answer(true)}>
              {answering ? "Saving…" : "Yes, it printed"}
            </button>
          </div>
        </Modal>
      ) : null}

      {phase.name === "failed" ? (
        <Modal title={`${phase.job.title[0]?.toUpperCase()}${phase.job.title.slice(1)} didn't print`} onClose={() => leave(false)} keepOnOutsideTap>
          <p className="text-lg text-ink">Check the printer&apos;s paper and power, then print again. Everything is still saved.</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={() => leave(false)}>
              Back
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={begin}>
              Print again
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
