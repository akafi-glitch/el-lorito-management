"use client";

import { useEffect, useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { holdRefresh } from "@/features/sync/hold";

import { recordPrintOutcomeAction } from "../actions";
import { needsTapToPrint, receiptIsOnPage } from "../print-timing";
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
  | { name: "preparing"; job: PrintJob }
  | { name: "ready"; job: PrintJob }
  | { name: "asking"; job: PrintJob }
  | { name: "failed"; job: PrintJob };

const OFFLINE = "Couldn't reach the server, so nothing was printed. Check the connection and try again.";
const NOT_READY = "The receipt couldn't be prepared. Nothing was printed. Try again.";

async function receiptSettled(): Promise<boolean> {
  await document.fonts?.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return receiptIsOnPage(document);
}

/**
 * The print workflow: the database records the print first, then the browser's print dialog opens, then the waiter
 * says whether paper came out. Nothing claims a receipt printed by itself. The receipt stays on the page until the
 * waiter has answered, because Safari builds its print preview after print() has already returned, and everything
 * else on the page is hidden when printing.
 */
export function PrintFlow({ employeeNumber, paperWidthMm, label, disabled, className, start, onError, onDone }: PrintFlowProps) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [answering, setAnswering] = useState(false);
  /** One tap, one print: a second tap before the screen has caught up does nothing. */
  const starting = useRef(false);

  // Live updates wait while printing is in progress, so neither the receipt nor the question can be swapped away.
  const busyPrinting = phase.name !== "idle";
  useEffect(() => {
    if (!busyPrinting) return;
    return holdRefresh();
  }, [busyPrinting]);

  function printNow(job: PrintJob) {
    window.print();
    setPhase({ name: "asking", job });
  }

  // Once the receipt is really on the page: print now if this browser allows it, or wait for one more tap.
  useEffect(() => {
    if (phase.name !== "preparing") return;
    const { job } = phase;
    let stale = false;
    void receiptSettled().then((ready) => {
      if (stale) return;
      starting.current = false;
      if (!ready) {
        setPhase({ name: "idle" });
        onError(NOT_READY);
        return;
      }
      const tapStillCounts = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
      if (needsTapToPrint({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, tapStillCounts })) setPhase({ name: "ready", job });
      else printNow(job);
    });
    return () => {
      stale = true;
    };
    // Runs once per print: the callbacks may change identity while it is under way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function begin() {
    if (starting.current) return;
    starting.current = true;
    setPhase({ name: "working" });
    try {
      const result = await start();
      if (result !== null && "job" in result) {
        setPhase({ name: "preparing", job: result.job });
        return;
      }
      starting.current = false;
      setPhase({ name: "idle" });
      if (result !== null) onError(result.message);
    } catch {
      starting.current = false;
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

  const job = phase.name === "preparing" || phase.name === "ready" || phase.name === "asking" || phase.name === "failed" ? phase.job : null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || phase.name !== "idle"}
        onClick={begin}
        className={className ?? buttonClasses("primary", "min-h-14 w-full text-lg")}
      >
        {phase.name === "working" || phase.name === "preparing" ? "Preparing…" : label}
      </button>

      {job?.content.kind === "kitchen" ? <KitchenReceipts receipts={job.content.receipts} paperWidthMm={paperWidthMm} /> : null}
      {job?.content.kind === "customer" ? <Receipt receipt={job.content.receipt} isCopy={job.content.isCopy} paperWidthMm={paperWidthMm} /> : null}

      {phase.name === "ready" ? (
        <Modal title="The receipt is ready" onClose={() => leave(null)} keepOnOutsideTap>
          <div className="flex flex-col gap-3">
            <button type="button" className={buttonClasses("primary", "min-h-16 w-full text-xl")} onClick={() => printNow(phase.job)}>
              Print now
            </button>
            <button type="button" className={buttonClasses("secondary")} onClick={() => leave(null)}>
              Back
            </button>
          </div>
        </Modal>
      ) : null}

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
