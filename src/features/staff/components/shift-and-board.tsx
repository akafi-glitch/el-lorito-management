"use client";

import Link from "next/link";
import { useState } from "react";

import { formatCents } from "@/features/menu/money";
import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";

import { assignDutyAction, finishShiftAction, startShiftAction } from "../actions";
import type { StaffBoard } from "../queries";
import { DUTY_LABEL, eligibleFor, employeeLabel, type Duty, type EmployeeRef } from "../rules";

import { RotationEditor, RotationList, useRotationOrder } from "./rotation-editor";

const selectClass =
  "min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none disabled:opacity-60";

/** The shift, with "Start shift" or "Finish shift", and who works each section this shift. */
export function ShiftAndBoard({ board }: { board: StaffBoard }) {
  const { busy, notice, run } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const waiters = eligibleFor("waiter", board.employees);
  const runners = eligibleFor("chips_runner", board.employees);
  const noShift = board.shift === null;
  const startOrder = useRotationOrder(board.rotation);
  const firstName = board.rotation.find((section) => section.code === startOrder.order[0])?.name ?? "";

  function startShift() {
    run(() => startShiftAction({ rotation: startOrder.order, firstName }), () => setConfirming(false));
  }

  function finishShift() {
    run(() => finishShiftAction(), () => setFinishing(false));
  }

  function assign(sectionCode: string, duty: Duty, value: string) {
    run(() => assignDutyAction({ sectionCode, duty, employeeId: value === "" ? null : Number(value) }));
  }

  return (
    <div className="flex flex-col gap-6">
      <NoticeBanner notice={notice} />

      <section aria-labelledby="shift-heading" className="rounded-2xl border border-glaze bg-paper p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="shift-heading" className="text-xl font-bold text-ink">
              Shift
            </h2>
            <p className="mt-1 text-base text-muted">
              {board.shift ? `Started ${board.shift.startedAt}.` : "The restaurant is closed. Start a shift so waiters can enter their sections."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {noShift ? (
              <Link href="/manage/shift-report" className={buttonClasses("secondary")}>
                Shift Report
              </Link>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => (noShift ? setConfirming(true) : setFinishing(true))}
              className={buttonClasses("primary")}
            >
              {noShift ? "Start shift" : "Finish shift"}
            </button>
          </div>
        </div>
      </section>

      {noShift ? null : <RotationEditor sections={board.rotation} nextSection={board.nextSection} />}

      <section aria-labelledby="board-heading" className="rounded-2xl border border-glaze bg-paper p-5">
        <h2 id="board-heading" className="text-xl font-bold text-ink">
          Who works where
        </h2>
        <p className="mt-1 text-sm text-muted">
          Changes save as soon as you pick a name. Moving someone keeps a record of where they were before.
        </p>
        {board.employees.length === 0 ? (
          <p className="mt-4 text-base text-ink">
            Add employees on the Employees tab first.
          </p>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-separate border-spacing-y-2 text-left">
            <thead>
              <tr className="text-sm text-muted">
                <th scope="col" className="w-28 px-2 font-semibold">Section</th>
                <th scope="col" className="px-2 font-semibold">{DUTY_LABEL.waiter}</th>
                <th scope="col" className="px-2 font-semibold">{DUTY_LABEL.chips_runner}</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.section.code}>
                  <th scope="row" className="px-2 text-lg font-bold text-ink">
                    {row.section.name}
                  </th>
                  <td className="px-2">
                    {row.takesWaiter ? (
                      <DutySelect
                        label={`Waiter for ${row.section.name}`}
                        current={row.waiter}
                        options={waiters}
                        disabled={busy || noShift}
                        onPick={(value) => assign(row.section.code, "waiter", value)}
                      />
                    ) : (
                      <p className="px-3 text-base text-muted">Any waiter can bill the Bar</p>
                    )}
                  </td>
                  <td className="px-2">
                    <DutySelect
                      label={`Chips runner for ${row.section.name}`}
                      current={row.runner}
                      options={runners}
                      disabled={busy || noShift}
                      onPick={(value) => assign(row.section.code, "chips_runner", value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {confirming ? (
        <Modal title="Start the shift" onClose={() => setConfirming(false)}>
          <p className="text-base">
            Drag the sections into the order seating should follow. The shift starts at number 1. Seated tables and orders
            stay as they are.
          </p>
          <div className="mt-4">
            <RotationList sections={board.rotation} order={startOrder.order} onPlace={startOrder.place} disabled={busy} />
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" disabled={busy} className={buttonClasses("primary", "flex-1")} onClick={startShift}>
              {busy ? "Starting…" : "Start shift"}
            </button>
            <button type="button" className={buttonClasses("secondary", "flex-1")} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {finishing ? (
        <Modal title="Finish this shift?" onClose={() => setFinishing(false)}>
          <p className="text-base">
            The restaurant closes. Waiters can&apos;t enter their sections until a manager starts a shift again, and every
            assignment is cleared. Seated tables and orders stay as they are.
          </p>
          {board.openTickets.length > 0 ? (
            <div data-testid="finish-open-tickets" className="mt-4 rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base text-ink">
              <p className="font-semibold">
                {board.openTickets.length === 1 ? "1 ticket is still open:" : `${board.openTickets.length} tickets are still open:`}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {board.openTickets.map((ticket) => (
                  <li key={ticket.number} className="flex justify-between gap-4">
                    <span>
                      Ticket #{ticket.number}
                      {ticket.tables ? `, Table ${ticket.tables}` : ""}
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(ticket.totalCents)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                They aren&apos;t in the Shift Report total until their customer receipt prints. If you finish now, waiters can
                only finish them after the next shift starts.
              </p>
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" disabled={busy} className={buttonClasses("primary", "flex-1")} onClick={finishShift}>
              {busy ? "Finishing…" : "Finish shift"}
            </button>
            <button type="button" className={buttonClasses("secondary", "flex-1")} onClick={() => setFinishing(false)}>
              Keep shift open
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function DutySelect({
  label,
  current,
  options,
  disabled,
  onPick,
}: {
  label: string;
  current: EmployeeRef | null;
  options: EmployeeRef[];
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  // Keep showing the current person even if they're no longer in the list (e.g. role changed).
  const list = current && !options.some((o) => o.id === current.id) ? [current, ...options] : options;
  return (
    <select
      aria-label={label}
      className={selectClass}
      disabled={disabled}
      value={current ? String(current.id) : ""}
      onChange={(event) => onPick(event.target.value)}
    >
      <option value="">Not assigned</option>
      {list.map((employee) => (
        <option key={employee.id} value={employee.id}>
          {employeeLabel(employee)}
        </option>
      ))}
    </select>
  );
}
