"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { STATUS_TILE } from "@/features/floor/components/status-styles";
import type { FloorTable } from "@/features/floor/layout";
import { STATUS_LABEL } from "@/features/floor/status";

import {
  crossSectionWarning,
  openTableProblem,
  tablePath,
  type TableAccess,
  type WaiterTableGroup,
  type WaiterView,
} from "../rules";

type WaiterTablesProps = {
  view: WaiterView;
  /** "/waiter/01": where this waiter's links start. */
  basePath: string;
};

type Pending = { table: FloorTable; warning: string };

/** The waiter's tables, the Bar, and (behind a warning) every other section. */
export function WaiterTables({ view, basePath }: WaiterTablesProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const unassigned = view.mine.length === 0;

  function choose(group: WaiterTableGroup, table: FloorTable) {
    const problem = openTableProblem(table);
    if (problem) {
      setNotice(problem);
      return;
    }
    setNotice(null);
    const access: TableAccess =
      group.access === "other"
        ? { kind: "other", sectionName: group.section.name, assignedTo: group.assignedTo }
        : { kind: group.access };
    const warning = crossSectionWarning(access);
    if (warning) setPending({ table, warning });
    else router.push(tablePath(basePath, table, false));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-ink">
          {unassigned ? (
            <strong>You&apos;re not assigned to a section this shift.</strong>
          ) : (
            <>
              Your {view.mySections.length === 1 ? "section" : "sections"}:{" "}
              <strong>{view.mySections.map((section) => section.name).join(", ")}</strong>
            </>
          )}
        </p>
        <button
          type="button"
          disabled={refreshing}
          className={buttonClasses("secondary")}
          onClick={() => startRefresh(() => router.refresh())}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div aria-live="polite" className="sticky top-2 z-10 rounded-xl bg-paper">
        {notice ? (
          <p role="alert" className="rounded-xl shadow-md border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
            {notice}
          </p>
        ) : null}
      </div>

      {view.mine.map((group) => (
        <TableGroup key={group.section.code} group={group} title={`Section ${group.section.name}`} onChoose={choose} />
      ))}

      {view.bar.map((group) => (
        <TableGroup key={group.section.code} group={group} title={`${group.section.name}: any waiter can bill it`} onChoose={choose} />
      ))}

      {view.others.length > 0 ? (
        <details open={unassigned} className="rounded-2xl border border-glaze bg-paper p-4 sm:p-5">
          <summary className="flex min-h-12 cursor-pointer items-center text-lg font-bold text-leaf">
            {unassigned ? "All sections" : "Other sections"}
          </summary>
          <p className="mt-1 text-sm text-muted">You can open these too. You&apos;ll be asked to confirm first.</p>
          <div className="mt-4 flex flex-col gap-6">
            {view.others.map((group) => (
              <TableGroup
                key={group.section.code}
                group={group}
                title={`Section ${group.section.name}: ${group.assignedTo ?? "no waiter assigned"}`}
                onChoose={choose}
                plain
              />
            ))}
          </div>
        </details>
      ) : null}

      {pending ? (
        <Modal title={`Open ${pending.table.label}?`} onClose={() => setPending(null)}>
          <p className="text-lg text-ink">{pending.warning}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={() => setPending(null)}>
              Cancel
            </button>
            <Link href={tablePath(basePath, pending.table, true)} className={buttonClasses("primary")}>
              Continue
            </Link>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function TableGroup({
  group,
  title,
  onChoose,
  plain = false,
}: {
  group: WaiterTableGroup;
  title: string;
  onChoose: (group: WaiterTableGroup, table: FloorTable) => void;
  plain?: boolean;
}) {
  const headingId = `group-${group.section.code}`;
  return (
    <section aria-labelledby={headingId} className={plain ? "" : "rounded-2xl border border-glaze bg-paper p-4 sm:p-5"}>
      <h2 id={headingId} className="text-xl font-bold text-ink">
        {title}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {group.tables.map((table) => (
          <li key={table.id}>
            <WaiterTableTile table={table} onPress={() => onChoose(group, table)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function WaiterTableTile({ table, onPress }: { table: FloorTable; onPress: () => void }) {
  const visit = table.visit;
  const guests = visit ? (visit.guestCount === 1 ? "1 guest" : `${visit.guestCount} guests`) : "No guests";
  const partners = visit && visit.tableLabels.length > 1 ? visit.tableLabels.filter((label) => label !== table.label) : [];
  const status = STATUS_LABEL[table.status];
  const spoken = [table.label, guests, partners.length > 0 ? `joined with ${partners.join(" and ")}` : null, status]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      aria-label={spoken}
      onClick={onPress}
      className={`flex min-h-24 w-full flex-col items-center justify-center rounded-xl border-2 px-2 py-2 text-center ${STATUS_TILE[table.status]} ${
        visit ? "" : "border-dashed"
      }`}
    >
      <span className="text-xl font-bold leading-tight text-ink">{table.label}</span>
      <span className={`text-sm text-ink ${visit ? "font-bold" : ""}`}>{guests}</span>
      {partners.length > 0 ? <span className="text-xs font-semibold text-ink">with {partners.join(" + ")}</span> : null}
      <span className="text-xs font-semibold text-ink/70">{status}</span>
    </button>
  );
}
