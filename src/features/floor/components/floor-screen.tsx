"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearTableAction,
  markChipsServedAction,
  seatPartyAction,
  setSectionOpenAction,
  undoChipsServedAction,
  type FloorActionResult,
} from "@/features/seating/actions";
import { recommendSeating, type SeatingOption } from "@/features/seating/recommend";
import { requestRefresh } from "@/features/sync/refresh";

import { allTables, combinedCapacity, type FloorMap, type FloorTable, type SectionInfo } from "../layout";
import { applyChanges, NO_CHANGES, settleChanges, type FloorChanges, type VisitChange } from "../optimistic";
import { STATUS_LABEL, STATUS_ORDER } from "../status";

import { FloorAreaCard } from "./floor-area-card";
import { NewPartyPanel } from "./new-party-panel";
import { SeatTray } from "./seat-tray";
import { STATUS_DOT } from "./status-styles";
import { TableDialog } from "./table-dialog";

type Notice = { tone: "ok" | "error"; text: string };
/** "Undo" after chips were served on this device: enough to undo exactly that change. */
type UndoOffer = { visitId: number; version: number; labels: string };

const OFFLINE = "Couldn't reach the server. Check the connection, then try again.";
const UNDO_SHOWN_MS = 20_000;

/**
 * The host's floor screen: suggestions, tap-to-seat, chips, clearing, and opening sections.
 * A tap shows its result at once (see ../optimistic.ts) and other tables stay usable meanwhile; the
 * database still decides, and a refused change goes back with a message.
 */
export function FloorScreen({ map: savedMap }: { map: FloorMap }) {
  const router = useRouter();
  const [guestCount, setGuestCount] = useState<number | null>(null);
  const [findFor, setFindFor] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialogCode, setDialogCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const [changes, setChanges] = useState<FloorChanges>(NO_CHANGES);
  const [sectionsBusy, setSectionsBusy] = useState(false);
  const seatIds = useRef(0);

  // Once the server's floor shows a change, the server's floor takes over.
  const [settledMap, setSettledMap] = useState(savedMap);
  if (settledMap !== savedMap) {
    setSettledMap(savedMap);
    setChanges(settleChanges(savedMap, changes));
  }

  const map = useMemo(() => applyChanges(savedMap, changes), [savedMap, changes]);
  const tables = useMemo(() => allTables(map), [map]);
  const byCode = useMemo(() => new Map(tables.map((table) => [table.code, table])), [tables]);

  // Selections and dialogs follow the latest floor: a table taken elsewhere drops out by itself.
  const selection = selected.filter((code) => byCode.get(code)?.status === "vacant");
  const dialogTable = dialogCode ? byCode.get(dialogCode) : undefined;
  const showDialog = dialogTable && dialogTable.status !== "vacant" && dialogTable.status !== "chips-needed";

  // Suggestions are recalculated whenever the floor changes, so they never point at a taken table.
  const advice = useMemo(() => {
    if (findFor === null) return null;
    return recommendSeating({
      guestCount: findFor,
      tables,
      sections: map.sections,
      combinations: map.combinations,
      nextSectionCode: map.nextSectionCode,
      rotation: map.rotation,
    });
  }, [findFor, tables, map.sections, map.combinations, map.nextSectionCode, map.rotation]);

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const rotation = map.rotation.flatMap((code) => {
    const section = map.sections.find((s) => s.code === code);
    return section ? [{ code, name: section.name, isOpen: section.isOpen, isNext: code === map.nextSectionCode }] : [];
  });

  function refresh() {
    if (!requestRefresh()) router.refresh();
  }

  function setVisitChange(visitId: number, change: VisitChange | null) {
    setChanges((current) => {
      const visits = new Map(current.visits);
      if (change) visits.set(visitId, change);
      else visits.delete(visitId);
      return { ...current, visits };
    });
  }

  /** Runs a change on one visit: shown at once, kept when saved, taken back when refused. */
  async function changeVisit(visitId: number, shown: Omit<VisitChange, "version">, action: () => Promise<FloorActionResult>, onSaved?: (version: number) => void) {
    setVisitChange(visitId, { ...shown, version: null });
    try {
      const result = await action();
      if (result.ok) {
        setVisitChange(visitId, { ...shown, version: result.version });
        onSaved?.(result.version);
      } else {
        setVisitChange(visitId, null);
        setNotice({ tone: "error", text: result.message });
      }
    } catch {
      setVisitChange(visitId, null);
      setNotice({ tone: "error", text: OFFLINE });
    }
    refresh();
  }

  function resetParty() {
    setGuestCount(null);
    setFindFor(null);
    setSelected([]);
  }

  async function seatTables(tableCodes: string[], guests: number, combinationCode: string | null) {
    const id = ++seatIds.current;
    const tableLabels = tableCodes.map((code) => byCode.get(code)?.label ?? code);
    setChanges((current) => ({ ...current, seats: [...current.seats, { id, tableCodes, guestCount: guests, tableLabels }] }));
    const dropSeat = () => setChanges((current) => ({ ...current, seats: current.seats.filter((seat) => seat.id !== id) }));
    resetParty();
    try {
      const result = await seatPartyAction({ tableCodes, guestCount: guests, combinationCode });
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      if (!result.ok) dropSeat();
    } catch {
      dropSeat();
      setNotice({ tone: "error", text: OFFLINE });
    }
    refresh();
  }

  function seat(option: SeatingOption) {
    if (findFor === null) return;
    void seatTables(option.tableCodes, findFor, option.combinationCode);
  }

  function seatSelection() {
    if (guestCount === null || selection.length === 0) return;
    const chosen = [...selection].sort();
    const match = map.combinations.find(
      (combination) => [...combination.tableCodes].sort().join("+") === chosen.join("+"),
    );
    void seatTables(selection, guestCount, match?.code ?? null);
  }

  function serveChips(table: FloorTable) {
    const visit = table.visit;
    if (!visit) return;
    setNotice(null);
    void changeVisit(
      visit.visitId,
      { chipsServed: true },
      () => markChipsServedAction({ visitId: visit.visitId, version: visit.version }),
      (version) => setUndo({ visitId: visit.visitId, version, labels: visit.tableLabels.join(" + ") }),
    );
  }

  function undoChips(visitId: number, version: number) {
    setUndo(null);
    setDialogCode(null);
    setNotice(null);
    void changeVisit(visitId, { chipsServed: false }, () => undoChipsServedAction({ visitId, version }), () =>
      setNotice({ tone: "ok", text: "Undone: the table needs chips again." }),
    );
  }

  function clearTable(table: FloorTable) {
    const visit = table.visit;
    if (!visit) return;
    setDialogCode(null);
    setUndo((current) => (current?.visitId === visit.visitId ? null : current));
    void changeVisit(visit.visitId, { cleared: true }, () => clearTableAction({ visitId: visit.visitId, version: visit.version }), () =>
      setNotice({ tone: "ok", text: "Table cleared." }),
    );
  }

  function onTablePress(table: FloorTable) {
    setNotice(null);
    if (table.status === "vacant") {
      setSelected((current) =>
        current.includes(table.code) ? current.filter((code) => code !== table.code) : [...current, table.code],
      );
    } else if (table.status === "chips-needed") {
      serveChips(table); // yellow to red straight away; Undo is there for a mistaken tap
    } else {
      setDialogCode(table.code);
    }
  }

  async function changeSection(sectionCode: string, isOpen: boolean) {
    setSectionsBusy(true);
    setDialogCode(null);
    try {
      const result = await setSectionOpenAction({ sectionCode, isOpen });
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    } catch {
      setNotice({ tone: "error", text: OFFLINE });
    }
    setSectionsBusy(false);
    refresh();
  }

  function toggleSection(section: SectionInfo) {
    void changeSection(section.code, !section.isOpen);
  }

  const selectedTables = selection.map((code) => byCode.get(code)).filter((t): t is FloorTable => t !== undefined);

  return (
    <div className={`flex flex-col gap-6 xl:flex-row xl:items-start ${selection.length > 0 ? "pb-56 sm:pb-36" : ""}`}>
      <aside className="xl:sticky xl:top-4 xl:w-80 xl:shrink-0">
        <NewPartyPanel
          guestCount={guestCount}
          onGuestCountChange={(value) => {
            setGuestCount(value);
            setFindFor(null);
          }}
          rotation={rotation}
          advice={advice}
          onFind={() => setFindFor(guestCount)}
          onSeat={seat}
          busy={false}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
          {undo ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-status-served bg-status-served/10 px-4 py-2">
              <p role="status" className="text-base font-semibold text-ink">
                Chips served at {undo.labels}.
              </p>
              <button
                type="button"
                onClick={() => undoChips(undo.visitId, undo.version)}
                aria-label={`Undo chips served at ${undo.labels}`}
                className="min-h-11 rounded-lg border-2 border-ink bg-paper px-5 text-base font-bold text-ink hover:bg-tile active:scale-95"
              >
                Undo
              </button>
            </div>
          ) : null}
          {notice ? (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              className={`rounded-xl border-2 px-4 py-3 text-base font-semibold ${
                notice.tone === "error"
                  ? "border-danger bg-danger/10 text-danger"
                  : "border-status-vacant bg-status-vacant/10 text-ink"
              }`}
            >
              {notice.text}
            </p>
          ) : null}
        </div>

        <ul aria-label="Table status counts" className="flex flex-wrap gap-x-6 gap-y-2">
          {STATUS_ORDER.map((status) => (
            <li key={status} className="flex items-center gap-2 text-base text-ink">
              <span aria-hidden="true" className={`size-3.5 rounded-full ${STATUS_DOT[status]}`} />
              <span>{STATUS_LABEL[status]}</span>
              <span className="font-bold tabular-nums">{map.counts[status]}</span>
            </li>
          ))}
        </ul>

        <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
          {map.areas.map((area) => (
            <FloorAreaCard
              key={area.code}
              area={area}
              staff={map.staff}
              selectedCodes={new Set(selection)}
              busy={sectionsBusy}
              onTablePress={onTablePress}
              onSectionToggle={toggleSection}
            />
          ))}
        </div>

        <section aria-labelledby="combinations-heading" className="rounded-2xl border border-glaze bg-paper p-4">
          <h2 id="combinations-heading" className="text-lg font-bold text-ink">
            Approved combinations
          </h2>
          <p className="mt-1 text-sm text-muted">
            Suggested for 7 or more guests when the Party areas are full. Over 12 guests, only X6 + X7 + X8. To join
            other tables, tap each free table on the map.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {map.combinations.map((combination) => (
              <li key={combination.code} className="rounded-lg border border-glaze px-3 py-2 text-base text-ink">
                <span className="font-semibold">{combination.label}</span>
                <span className="text-muted">
                  {", "}
                  {combination.capacity === null ? "seats not set" : `${combination.capacity} chairs`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {selection.length > 0 ? (
        <SeatTray
          tableLabels={selectedTables.map((table) => table.label)}
          chairs={combinedCapacity(selectedTables.map((table) => table.capacity))}
          guestCount={guestCount}
          onGuestCountChange={(value) => {
            setGuestCount(value);
            setFindFor(null);
          }}
          onSeat={seatSelection}
          onCancel={() => setSelected([])}
          busy={false}
        />
      ) : null}

      {showDialog && dialogTable ? (
        <TableDialog
          table={dialogTable}
          busy={dialogTable.pending === true || sectionsBusy}
          onClose={() => setDialogCode(null)}
          onUndoChips={(table) => table.visit && undoChips(table.visit.visitId, table.visit.version)}
          onClear={clearTable}
          onOpenSection={(table) => void changeSection(table.section.code, true)}
        />
      ) : null}
    </div>
  );
}
