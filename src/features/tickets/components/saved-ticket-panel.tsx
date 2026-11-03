"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Notice } from "@/components/use-action-runner";
import { TotalsBlock } from "@/features/billing/components/totals-block";
import { computeTotals } from "@/features/billing/tax";
import { formatCents } from "@/features/menu/money";
import { ITEM_NOTE_MAX, MAX_QUANTITY } from "@/features/menu/order-draft";
import { printCustomerAction, printKitchenAction } from "@/features/printing/actions";
import { PrintFlow, type PrintStart } from "@/features/printing/components/print-flow";

import { cancelTicketAction, changeTicketAction, type ChangeTicketResult } from "../actions";
import { KITCHEN_TEXT, staffLabel } from "../rules";
import { NOTE_MAX, type ChangeTicketInput } from "../schema";
import type { SavedBatch, SavedLine, SavedTicket } from "../types";

type SavedTicketPanelProps = {
  ticket: SavedTicket;
  employeeNumber: string;
  paperWidthMm: 58 | 80;
  /** A new order is on screen, not saved yet: the bill wouldn't include it. */
  orderOnScreen: boolean;
  onNotice: (notice: Notice | null) => void;
  onChanged: () => void;
};

const OFFLINE = "Couldn't reach the server. Nothing was changed. Check the connection, then try again.";

/** The note being edited: on a whole order, or on one item. */
type NoteTarget = { kind: "order"; batch: SavedBatch } | { kind: "item"; line: SavedLine };
const KITCHEN_DOT: Record<SavedBatch["kitchen"], string> = {
  "not-sent": "bg-status-chips",
  waiting: "bg-status-chips",
  failed: "bg-danger",
  printed: "bg-status-vacant",
};

/**
 * The customer's ticket: every saved order, what it comes to, and printing the bill. Taps on quantities
 * show at once and are saved in order, each from the version the last one left.
 */
export function SavedTicketPanel({ ticket, employeeNumber, paperWidthMm, orderOnScreen, onNotice, onChanged }: SavedTicketPanelProps) {
  const editable = ticket.status === "open";
  const [removing, setRemoving] = useState<SavedLine | null>(null);
  const [editingNote, setEditingNote] = useState<NoteTarget | null>(null);
  const [noteText, setNoteText] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** What this screen has changed that the saved ticket doesn't show yet. Null quantity: removed. */
  const [shown, setShown] = useState<ReadonlyMap<number, number | null>>(new Map());

  const version = useRef(ticket.version);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);

  // A newer ticket arrived (our own change, or another device through live updates).
  useEffect(() => {
    version.current = Math.max(version.current, ticket.version);
    if (waiting.current === 0 && ticket.version >= version.current) setShown(new Map());
  }, [ticket.version]);

  const batches = useMemo(
    () =>
      ticket.batches
        .map((batch) => ({
          ...batch,
          lines: batch.lines.flatMap((line) => {
            if (!shown.has(line.lineId)) return [line];
            const quantity = shown.get(line.lineId);
            return quantity ? [{ ...line, quantity, totalCents: line.unitCents * quantity }] : [];
          }),
        }))
        .filter((batch) => batch.lines.length > 0),
    [ticket.batches, shown],
  );
  const totals = useMemo(
    () => (shown.size === 0 ? ticket.totals : computeTotals(batches.flatMap((batch) => batch.lines), ticket.totals.rates)),
    [batches, shown, ticket.totals],
  );
  const empty = batches.length === 0;

  /** Saves changes one after another, each based on the version the previous one left. */
  function send(changes: ChangeTicketInput["changes"], onSaved?: () => void) {
    waiting.current += 1;
    queue.current = queue.current.then(async () => {
      let result: ChangeTicketResult;
      try {
        result = await changeTicketAction({ employeeNumber, ticketId: ticket.id, version: version.current, changes });
      } catch {
        result = { ok: false, message: OFFLINE, reload: false };
      }
      waiting.current -= 1;
      if (result.ok) {
        version.current = result.version;
        onSaved?.();
      } else {
        onNotice({ tone: "error", text: result.message });
        setShown(new Map());
      }
      if (waiting.current === 0) onChanged();
    });
  }

  function changeQuantity(line: SavedLine, quantity: number) {
    onNotice(null);
    setShown((current) => new Map(current).set(line.lineId, quantity));
    send([{ op: "quantity", lineId: line.lineId, quantity }]);
  }

  function removeLine(line: SavedLine) {
    setRemoving(null);
    onNotice(null);
    setShown((current) => new Map(current).set(line.lineId, null));
    send([{ op: "remove", lineId: line.lineId }]);
  }

  function saveNote() {
    if (!editingNote) return;
    const change: ChangeTicketInput["changes"][number] =
      editingNote.kind === "order"
        ? { op: "notes", batchId: editingNote.batch.id, notes: noteText }
        : { op: "line_notes", lineId: editingNote.line.lineId, notes: noteText };
    setEditingNote(null);
    send([change], () => onNotice({ tone: "ok", text: "Note saved." }));
  }

  async function cancelTicket() {
    setConfirmCancel(false);
    try {
      const result = await cancelTicketAction({ employeeNumber, ticketId: ticket.id, version: version.current });
      onNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    } catch {
      onNotice({ tone: "error", text: OFFLINE });
    }
    onChanged();
  }

  async function startCustomerPrint(): Promise<PrintStart> {
    await queue.current; // the bill includes every change just made on this screen
    const result = await printCustomerAction({
      employeeNumber,
      ticketId: ticket.id,
      version: editable ? version.current : null,
      clientKey: crypto.randomUUID(),
    });
    if (!result.ok) {
      if (result.reload) onChanged();
      return { message: result.message };
    }
    return {
      job: {
        attemptIds: [result.attemptId],
        title: result.isCopy ? "the copy of the receipt" : "the customer receipt",
        question: result.isCopy ? "" : "Yes finalizes this ticket and resets the table for a new order.",
        content: { kind: "customer", receipt: result.receipt, isCopy: result.isCopy },
      },
    };
  }

  async function startKitchenReprint(batch: SavedBatch): Promise<PrintStart> {
    const result = await printKitchenAction({ employeeNumber, ticketId: ticket.id, batchIds: [batch.id], clientKey: crypto.randomUUID() });
    if (!result.ok) {
      if (result.reload) onChanged();
      return { message: result.message };
    }
    return { job: { attemptIds: result.attemptIds, title: "the kitchen receipt", question: "", content: { kind: "kitchen", receipts: result.receipts } } };
  }

  return (
    <section aria-labelledby="saved-ticket-heading" className="rounded-2xl border border-glaze bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="saved-ticket-heading" className="text-2xl font-bold text-ink">
          Ticket #{ticket.number}
        </h2>
        <p className="text-sm text-muted">
          {staffLabel(ticket.maker)} · {ticket.createdTime}
        </p>
      </div>

      <ol className="mt-3 flex flex-col gap-4">
        {batches.map((batch) => (
          <li key={batch.id} className="rounded-xl border border-glaze p-3" data-testid={`order-${batch.no}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="font-bold text-ink">
                Order {batch.no} <span className="text-sm font-normal text-muted">· Waiter {batch.waiterNumber} · {batch.time}</span>
              </h3>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${KITCHEN_DOT[batch.kitchen]}`} />
                {KITCHEN_TEXT[batch.kitchen]}
              </span>
            </div>
            <ul className="mt-2 flex flex-col divide-y divide-glaze">
              {batch.lines.map((line) => (
                <li key={line.lineId} className="flex flex-col gap-2 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-ink">
                      {line.quantity} × {line.name}{" "}
                      <span className="text-sm text-muted">({formatCents(line.unitCents)})</span>
                      {line.isCustom ? <span className="ml-2 rounded bg-tile px-1.5 py-0.5 text-xs font-semibold text-muted">Custom</span> : null}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">{formatCents(line.totalCents)}</span>
                  </div>
                  {line.notes ? <p className="rounded-lg bg-tile px-3 py-1.5 text-sm font-semibold text-ink">Note: {line.notes}</p> : null}
                  {editable ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2" role="group" aria-label={`Saved quantity of ${line.name}`}>
                        <button
                          type="button"
                          aria-label={`One fewer saved ${line.name}`}
                          disabled={line.quantity <= 1}
                          onClick={() => changeQuantity(line, line.quantity - 1)}
                          className="flex size-11 items-center justify-center rounded-lg border border-glaze text-xl font-bold text-leaf hover:border-leaf active:scale-95 disabled:opacity-40"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          aria-label={`One more saved ${line.name}`}
                          disabled={line.quantity >= MAX_QUANTITY}
                          onClick={() => changeQuantity(line, line.quantity + 1)}
                          className="flex size-11 items-center justify-center rounded-lg border border-glaze text-xl font-bold text-leaf hover:border-leaf active:scale-95 disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`${line.notes ? "Edit the note on" : "Add a note to"} saved ${line.name}`}
                          onClick={() => {
                            setNoteText(line.notes ?? "");
                            setEditingNote({ kind: "item", line });
                          }}
                          className={buttonClasses("quiet", "min-h-11 px-3 text-sm")}
                        >
                          {line.notes ? "Edit note" : "Add note"}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove saved ${line.name}`}
                          onClick={() => setRemoving(line)}
                          className="min-h-11 rounded-lg px-3 font-semibold text-danger hover:bg-danger/10"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {batch.notes ? <p className="mt-2 rounded-lg bg-tile px-3 py-2 text-base font-semibold text-ink">Note: {batch.notes}</p> : null}
            {editable ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClasses("quiet", "min-h-11 px-3 text-sm")}
                  onClick={() => {
                    setNoteText(batch.notes ?? "");
                    setEditingNote({ kind: "order", batch });
                  }}
                >
                  {batch.notes ? "Edit order note" : "Add order note"}
                </button>
                {batch.kitchen === "printed" || batch.kitchen === "waiting" ? (
                  <PrintFlow
                    employeeNumber={employeeNumber}
                    paperWidthMm={paperWidthMm}
                    label={`Reprint order ${batch.no} for the kitchen`}
                    className={buttonClasses("quiet", "min-h-11 px-3 text-sm")}
                    start={() => startKitchenReprint(batch)}
                    onError={(text) => onNotice({ tone: "error", text })}
                    onDone={onChanged}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-4 border-t-2 border-ink/20 pt-3">
        <TotalsBlock totals={totals} />
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {editable ? (
          <a href="#menu-heading" className={buttonClasses("secondary", "min-h-14 sm:flex-1")}>
            Add more items
          </a>
        ) : null}
        <div className="flex flex-col sm:flex-1">
          <PrintFlow
            employeeNumber={employeeNumber}
            paperWidthMm={paperWidthMm}
            label={editable ? "Print Customer Receipt" : "Reprint Customer Receipt"}
            disabled={(editable && orderOnScreen) || empty}
            start={startCustomerPrint}
            onError={(text) => onNotice({ tone: "error", text })}
            onDone={(printed) => {
              if (printed && editable) onNotice({ tone: "ok", text: `Ticket #${ticket.number} is finalized. The table is ready for a new order.` });
              onChanged();
            }}
          />
          {editable && orderOnScreen ? <p className="mt-1 text-sm font-semibold text-ink">Save the new order first: the receipt only shows saved items.</p> : null}
        </div>
      </div>

      {editable ? (
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          className="mt-3 min-h-12 w-full rounded-lg font-semibold text-danger hover:bg-danger/10"
        >
          Cancel this ticket
        </button>
      ) : null}

      {removing ? (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="text-lg text-ink">
            It comes off the bill. If the kitchen already has it, tell them.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={() => setRemoving(null)}>
              Keep it
            </button>
            <button type="button" className={buttonClasses("primary", "bg-danger hover:bg-danger/90")} onClick={() => removeLine(removing)}>
              Remove
            </button>
          </div>
        </Modal>
      ) : null}

      {editingNote ? (
        <Modal
          title={editingNote.kind === "order" ? `Note for order ${editingNote.batch.no}` : `Note for ${editingNote.line.name}`}
          onClose={() => setEditingNote(null)}
        >
          <label htmlFor="edit-note" className="sr-only">
            Note
          </label>
          <textarea
            id="edit-note"
            rows={3}
            maxLength={editingNote.kind === "order" ? NOTE_MAX : ITEM_NOTE_MAX}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            className="w-full rounded-lg border border-glaze bg-paper px-3 py-2 text-base text-ink focus:border-leaf focus:outline-none"
          />
          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={() => setEditingNote(null)}>
              Cancel
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={saveNote}>
              Save note
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmCancel ? (
        <Modal title={`Cancel ticket #${ticket.number}?`} onClose={() => setConfirmCancel(false)}>
          <p className="text-lg text-ink">It stays in the history, marked cancelled. This can&apos;t be undone.</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={() => setConfirmCancel(false)}>
              Keep ticket
            </button>
            <button type="button" className={buttonClasses("primary", "bg-danger hover:bg-danger/90")} onClick={cancelTicket}>
              Cancel ticket
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
