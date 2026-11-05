"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import type { Notice } from "@/components/use-action-runner";
import { MenuScreen } from "@/features/menu/components/menu-screen";
import type { Draft } from "@/features/menu/order-draft";
import { useMenuData } from "@/features/menu/use-menu-data";
import { printKitchenAction } from "@/features/printing/actions";
import { PrintFlow, type PrintStart } from "@/features/printing/components/print-flow";
import { requestRefresh } from "@/features/sync/refresh";

import { tablePath } from "@/features/waiter/rules";

import { saveOrderAction, saveToGoOrderAction, type SaveOrderResult } from "../actions";
import { batchesToSend, orderLinesFromDraft } from "../rules";
import { NOTE_MAX } from "../schema";
import type { SavedTicket } from "../types";

import { SavedTicketPanel } from "./saved-ticket-panel";

type TableOrderScreenProps = {
  employeeNumber: string;
  /** Null for a new to-go order, which gets its spot when it is saved. */
  tableCode: string | null;
  /** For a new to-go order: "/waiter/01", to move to the spot's own page once saved. */
  toGoBasePath?: string;
  /** The table's open ticket, or null until the first order is saved. */
  ticket: SavedTicket | null;
  menuVersion: number;
  timeZone: string;
  nowIso: string;
  paperWidthMm: 58 | 80;
};

const OFFLINE = "Couldn't reach the server. Nothing was saved. Check the connection, then try again.";

/**
 * One table: what is saved on its ticket, and the new order being built. The order stays on the device
 * until Save Order or Print Kitchen Receipt; the database then sets the prices of menu items.
 */
export function TableOrderScreen({ employeeNumber, tableCode, toGoBasePath, ticket, menuVersion, timeZone, nowIso, paperWidthMm }: TableOrderScreenProps) {
  const router = useRouter();
  const { data, failed, retry } = useMenuData(menuVersion);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraftState] = useState<Draft>([]);
  const [notes, setNotesState] = useState("");
  const [saving, setSaving] = useState(false);
  /** One key per order as it stands: pressing Save twice sends the same key, so it saves once. */
  const clientKey = useRef<string | null>(null);
  /** The page a new to-go order moves to, once it is saved and printing is over. */
  const spotPage = useRef<string | null>(null);

  const dirty = draft.length > 0;
  const hasToSend = batchesToSend(ticket).length > 0;

  function refresh() {
    if (spotPage.current) router.replace(spotPage.current);
    else if (!requestRefresh()) router.refresh();
  }

  function setDraft(update: (current: Draft) => Draft) {
    clientKey.current = null; // a changed order is a new order
    setDraftState(update);
  }

  function setNotes(value: string) {
    clientKey.current = null;
    setNotesState(value);
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

  const showError = (text: string) => setNotice({ tone: "error", text });

  /** Saves the order on screen as a new order on the ticket. Null when it was refused (already said why). */
  async function saveDraft() {
    clientKey.current ??= crypto.randomUUID();
    const order = { employeeNumber, clientKey: clientKey.current, lines: orderLinesFromDraft(draft), notes };
    const result: SaveOrderResult & { tableCode?: string } =
      tableCode === null ? await saveToGoOrderAction(order) : await saveOrderAction({ ...order, tableCode });
    if (!result.ok) {
      showError(result.message);
      if (result.reload) refresh();
      return null;
    }
    if (toGoBasePath && result.tableCode) spotPage.current = tablePath(toGoBasePath, result.tableCode);
    setDraftState([]);
    setNotesState("");
    clientKey.current = null;
    return result;
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveDraft();
      if (result) setNotice({ tone: "ok", text: result.message });
    } catch {
      showError(OFFLINE);
    }
    setSaving(false);
    refresh();
  }

  /** Print Kitchen Receipt: saves what is on screen first, then prints the orders not printed yet. */
  async function startKitchenPrint(): Promise<PrintStart | null> {
    let ticketId = ticket?.id ?? null;
    if (dirty) {
      const saved = await saveDraft();
      if (!saved) return null;
      ticketId = saved.ticketId;
    }
    if (ticketId === null) return null;
    const result = await printKitchenAction({ employeeNumber, ticketId, batchIds: null, clientKey: crypto.randomUUID() });
    if (!result.ok) {
      if (result.reload) refresh();
      return { message: result.message };
    }
    return {
      job: {
        attemptIds: result.attemptIds,
        title: "the kitchen receipt",
        question: "",
        content: { kind: "kitchen", receipts: result.receipts },
      },
    };
  }

  const banner = (
    <div aria-live="polite" className="sticky top-2 z-20 empty:hidden">
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border-2 px-4 py-3 text-base font-semibold shadow-md ${
            notice.tone === "error" ? "border-danger bg-[#fdecea] text-danger" : "border-status-vacant bg-tile text-ink"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {banner}

      {ticket ? (
        <SavedTicketPanel
          key={ticket.id}
          ticket={ticket}
          employeeNumber={employeeNumber}
          paperWidthMm={paperWidthMm}
          orderOnScreen={dirty}
          onNotice={setNotice}
          onChanged={refresh}
        />
      ) : null}

      {data ? (
        <MenuScreen
          menu={data.menu}
          tax={data.tax}
          timeZone={timeZone}
          nowIso={nowIso}
          draft={draft}
          onDraftChange={setDraft}
          orderTitle={ticket ? `New order for ticket #${ticket.number}` : tableCode === null ? "New to-go order" : "New order"}
          orderFooter={
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="order-notes" className="text-sm font-semibold text-ink">
                  Note for the whole order (optional)
                </label>
                <textarea
                  id="order-notes"
                  rows={2}
                  maxLength={NOTE_MAX}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Allergy, bring everything together…"
                  className="w-full rounded-lg border border-glaze bg-paper px-3 py-2 text-base text-ink focus:border-leaf focus:outline-none"
                />
              </div>
              <button type="button" disabled={saving || !dirty} onClick={save} className={buttonClasses("secondary", "min-h-14 w-full text-lg")}>
                {saving ? "Saving…" : "Save Order"}
              </button>
              <PrintFlow
                employeeNumber={employeeNumber}
                paperWidthMm={paperWidthMm}
                label="Print Kitchen Receipt"
                disabled={saving || (!dirty && !hasToSend)}
                start={startKitchenPrint}
                onError={showError}
                onDone={(printed) => {
                  if (printed) setNotice({ tone: "ok", text: "Sent to the kitchen. The order stays on the ticket." });
                  refresh();
                }}
              />
              <p className="text-xs text-muted">Printing saves the order first. Only orders not yet printed go to the kitchen, and the receipt shows no prices.</p>
            </div>
          }
        />
      ) : failed ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-glaze bg-paper p-5">
          <p role="alert" className="text-base font-semibold text-danger">
            The menu couldn&apos;t be loaded. Check the connection.
          </p>
          <button type="button" className={buttonClasses("primary")} onClick={retry}>
            Try again
          </button>
        </div>
      ) : (
        <p role="status" className="rounded-2xl border border-glaze bg-paper p-5 text-base font-semibold text-muted">
          Loading the menu…
        </p>
      )}
    </div>
  );
}
