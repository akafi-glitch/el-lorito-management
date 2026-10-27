"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  clearTableAction,
  markChipsServedAction,
  seatPartyAction,
  setSectionOpenAction,
} from "@/features/seating/actions";
import { recommendSeating, type SeatingOption } from "@/features/seating/recommend";
import type { ActionResult } from "@/features/seating/schema";

import { allTables, combinedCapacity, type FloorMap, type FloorTable, type SectionInfo } from "../layout";
import { STATUS_LABEL, STATUS_ORDER } from "../status";

import { FloorAreaCard } from "./floor-area-card";
import { NewPartyPanel } from "./new-party-panel";
import { SeatTray } from "./seat-tray";
import { STATUS_DOT } from "./status-styles";
import { TableDialog } from "./table-dialog";

type Notice = { tone: "ok" | "error"; text: string };

const OFFLINE = "Couldn't reach the server. Check the connection, then try again.";

/** The host's floor screen: suggestions, tap-to-seat, chips, clearing, and opening sections. */
export function FloorScreen({ map }: { map: FloorMap }) {
  const [guestCount, setGuestCount] = useState<number | null>(null);
  const [findFor, setFindFor] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialogCode, setDialogCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startTransition] = useTransition();

  const tables = useMemo(() => allTables(map), [map]);
  const byCode = useMemo(() => new Map(tables.map((table) => [table.code, table])), [tables]);

  // Selections and dialogs follow the latest floor: a table taken elsewhere drops out by itself.
  const selection = selected.filter((code) => byCode.get(code)?.status === "vacant");
  const dialogTable = dialogCode ? byCode.get(dialogCode) : undefined;
  const showDialog = dialogTable && dialogTable.status !== "vacant";

  // Suggestions are recalculated whenever the floor changes, so they never point at a taken table.
  const advice = useMemo(() => {
    if (findFor === null) return null;
    return recommendSeating({
      guestCount: findFor,
      tables,
      sections: map.sections,
      combinations: map.combinations,
      nextSectionCode: map.nextSectionCode,
    });
  }, [findFor, tables, map.sections, map.combinations, map.nextSectionCode]);

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const nextSectionName = map.sections.find((section) => section.code === map.nextSectionCode)?.name ?? null;

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        const result = await action();
        setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
        if (result.ok) onSuccess?.();
      } catch {
        setNotice({ tone: "error", text: OFFLINE });
      }
    });
  }

  function resetParty() {
    setGuestCount(null);
    setFindFor(null);
    setSelected([]);
  }

  function seat(option: SeatingOption) {
    if (findFor === null) return;
    run(
      () => seatPartyAction({ tableCodes: option.tableCodes, guestCount: findFor, combinationCode: option.combinationCode }),
      resetParty,
    );
  }

  function seatSelection() {
    if (guestCount === null || selection.length === 0) return;
    const chosen = [...selection].sort();
    const match = map.combinations.find(
      (combination) => [...combination.tableCodes].sort().join("+") === chosen.join("+"),
    );
    run(
      () => seatPartyAction({ tableCodes: selection, guestCount, combinationCode: match?.code ?? null }),
      resetParty,
    );
  }

  function onTablePress(table: FloorTable) {
    setNotice(null);
    if (table.status === "vacant") {
      setSelected((current) =>
        current.includes(table.code) ? current.filter((code) => code !== table.code) : [...current, table.code],
      );
    } else {
      setDialogCode(table.code);
    }
  }

  function toggleSection(section: SectionInfo) {
    run(() => setSectionOpenAction({ sectionCode: section.code, isOpen: !section.isOpen }));
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
          nextSectionName={nextSectionName}
          advice={advice}
          onFind={() => setFindFor(guestCount)}
          onSeat={seat}
          busy={busy}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div aria-live="polite" className="min-h-0">
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
              selectedCodes={new Set(selection)}
              busy={busy}
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
          busy={busy}
        />
      ) : null}

      {showDialog && dialogTable ? (
        <TableDialog
          table={dialogTable}
          busy={busy}
          onClose={() => setDialogCode(null)}
          onChipsServed={(table) =>
            table.visit &&
            run(() => markChipsServedAction({ visitId: table.visit!.visitId, version: table.visit!.version }), () =>
              setDialogCode(null),
            )
          }
          onClear={(table) =>
            table.visit &&
            run(() => clearTableAction({ visitId: table.visit!.visitId, version: table.visit!.version }), () =>
              setDialogCode(null),
            )
          }
          onOpenSection={(table) =>
            run(() => setSectionOpenAction({ sectionCode: table.section.code, isOpen: true }), () => setDialogCode(null))
          }
        />
      ) : null}
    </div>
  );
}
