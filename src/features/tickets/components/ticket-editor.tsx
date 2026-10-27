"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Notice } from "@/components/use-action-runner";
import { MenuScreen } from "@/features/menu/components/menu-screen";
import type { Draft } from "@/features/menu/order-draft";
import type { TaxSetup } from "@/features/billing/setup";
import type { Menu } from "@/features/menu/types";

import { PrintFlow, type PrintTarget } from "@/features/printing/components/print-flow";

import { cancelTicketAction, saveTicketAction, type TicketActionResult } from "../actions";
import { draftFromTicket, hasUnsavedChanges, savedPriceMap, withTicket } from "../rules";
import type { SavedTicket } from "../types";

type TicketEditorProps = {
  menu: Menu;
  tax: TaxSetup;
  timeZone: string;
  nowIso: string;
  employeeNumber: string;
  visitId: number;
  /** The open ticket being changed, or null for a new one. */
  ticket: SavedTicket | null;
  /** Table page link, for moving between tickets. */
  tableHref: string;
  paperWidthMm: 58 | 80;
};

const OFFLINE = "Couldn't reach the server. Nothing was saved. Check the connection, then try again.";

/** Build or change a ticket, then save it. The database sets the final prices. */
export function TicketEditor({ menu, tax, timeZone, nowIso, employeeNumber, visitId, ticket, tableHref, paperWidthMm }: TicketEditorProps) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const savedKey = `${ticket?.id ?? "new"}:${ticket?.version ?? 0}`;
  const [shownKey, setShownKey] = useState(savedKey);
  /** The saved lines the screen last showed, to tell whether the waiter has unsaved changes. */
  const [shownSaved, setShownSaved] = useState<Draft>(() => draftFromTicket(ticket));
  const [draft, setDraft] = useState<Draft>(() => draftFromTicket(ticket));
  /** The saved version this screen's changes are based on (sent with every save). */
  const [baseVersion, setBaseVersion] = useState<number | null>(ticket?.version ?? null);
  /** Another device saved this ticket while this screen had unsaved changes. */
  const [conflict, setConflict] = useState(false);
  /** After a refused save, show the newer version as soon as it arrives. */
  const [takeNewer, setTakeNewer] = useState(false);

  // A newer saved version arrived (our own save, or another device through live updates).
  if (shownKey !== savedKey) {
    const sameTicket = shownKey.split(":")[0] === savedKey.split(":")[0];
    const newSaved = draftFromTicket(ticket);
    const hadChanges = hasUnsavedChanges(draft, shownSaved);
    setShownKey(savedKey);
    setShownSaved(newSaved);
    if (!sameTicket || takeNewer || !hadChanges || !hasUnsavedChanges(draft, newSaved)) {
      setDraft(newSaved);
      setBaseVersion(ticket?.version ?? null);
      setConflict(false);
      setTakeNewer(false);
    } else {
      setConflict(true); // keep the waiter's changes; saving them would be refused, so say so now
    }
  }

  const saved = draftFromTicket(ticket);
  const dirty = hasUnsavedChanges(draft, saved);

  function showNewer() {
    setDraft(saved);
    setBaseVersion(ticket?.version ?? null);
    setConflict(false);
  }

  // Warn before leaving the page with an unsaved order.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  function finish(result: TicketActionResult, nextTicket: number | null) {
    setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    if (result.ok) {
      router.replace(withTicket(tableHref, nextTicket));
      router.refresh();
    } else if (result.reload) {
      setTakeNewer(true);
      router.refresh();
    }
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await saveTicketAction({
          employeeNumber,
          visitId,
          ticketId: ticket?.id ?? null,
          version: ticket ? baseVersion : null,
          lines: draft.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
        });
        finish(result, result.ok ? result.ticketNumber : (ticket?.number ?? null));
      } catch {
        setNotice({ tone: "error", text: OFFLINE });
      }
    });
  }

  /** Printing always prints what is saved: save first if the screen has changes. */
  async function prepareForPrint(): Promise<PrintTarget | null> {
    if (ticket && !dirty) return { visitId, ticketId: ticket.id, version: ticket.version, ticketNumber: ticket.number };
    const result = await saveTicketAction({
      employeeNumber,
      visitId,
      ticketId: ticket?.id ?? null,
      version: ticket ? baseVersion : null,
      lines: draft.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
    });
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      if (result.reload) {
        setTakeNewer(true);
        router.refresh();
      }
      return null;
    }
    return { visitId, ticketId: result.ticketId, version: result.version, ticketNumber: result.ticketNumber };
  }

  function cancelTicket() {
    if (!ticket) return;
    setConfirmCancel(false);
    startTransition(async () => {
      try {
        const result = await cancelTicketAction({ employeeNumber, visitId, ticketId: ticket.id, version: baseVersion ?? ticket.version });
        finish(result, result.ok ? null : ticket.number);
      } catch {
        setNotice({ tone: "error", text: OFFLINE });
      }
    });
  }

  const status = busy
    ? "Saving…"
    : ticket === null
      ? draft.length === 0
        ? "New ticket: tap menu items to add them."
        : "Not saved yet."
      : dirty
        ? "Changes not saved yet."
        : "Saved. Not printed, so it can still be changed.";

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sticky top-2 z-20 rounded-xl bg-paper empty:hidden">
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={`rounded-xl border-2 px-4 py-3 text-base font-semibold shadow-md ${
              notice.tone === "error" ? "border-danger bg-danger/10 text-danger" : "border-status-vacant bg-status-vacant/10 text-ink"
            }`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      {conflict ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-status-chips bg-status-chips/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base font-semibold text-ink">
            Someone else just saved a change to this ticket. Your changes here aren&apos;t saved and can&apos;t be saved over theirs.
          </p>
          <button type="button" onClick={showNewer} className={buttonClasses("primary", "shrink-0")}>
            Show their version
          </button>
        </div>
      ) : null}

      <MenuScreen
        menu={menu}
        timeZone={timeZone}
        nowIso={nowIso}
        draft={draft}
        onDraftChange={(update) => setDraft((current) => update(current))}
        savedLines={savedPriceMap(ticket)}
        tax={tax}
        orderTitle={ticket ? `Ticket #${ticket.number}` : "New ticket"}
        orderFooter={
          <div className="flex flex-col gap-3">
            <p className={`text-sm font-semibold ${dirty ? "text-ink" : "text-muted"}`} data-testid="ticket-status">
              {status}
            </p>
            <PrintFlow
              employeeNumber={employeeNumber}
              paperWidthMm={paperWidthMm}
              mode={{ kind: "first", prepare: prepareForPrint }}
              label={dirty ? "Save and print" : "Print ticket"}
              disabled={busy || draft.length === 0}
              onError={(text) => setNotice({ tone: "error", text })}
              ticketHref={(number) => withTicket(tableHref, number)}
            />
            <button
              type="button"
              disabled={busy || !dirty || draft.length === 0}
              onClick={save}
              className={buttonClasses("secondary", "w-full")}
            >
              {ticket ? "Save changes" : "Save ticket"}
            </button>
            {ticket && dirty ? (
              <button type="button" disabled={busy} onClick={() => setDraft(saved)} className={buttonClasses("secondary", "w-full")}>
                Undo changes
              </button>
            ) : null}
            {ticket ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
                className="min-h-12 w-full rounded-lg font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
              >
                Cancel this ticket
              </button>
            ) : null}
            <p className="text-xs text-muted">Prices and tax are set when the ticket is saved. Printing saves first and then locks the ticket.</p>
          </div>
        }
      />

      {confirmCancel && ticket ? (
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
    </div>
  );
}
