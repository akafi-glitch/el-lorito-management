"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";

import { assignDutyAction, startShiftAction } from "../actions";
import type { StaffBoard } from "../queries";
import { DUTY_LABEL, eligibleFor, employeeLabel, type Duty, type EmployeeRef } from "../rules";

const selectClass =
  "min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none disabled:opacity-60";

/** Current shift, "Start new shift", and who works each section this shift. */
export function ShiftAndBoard({ board }: { board: StaffBoard }) {
  const { busy, notice, run } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const waiters = eligibleFor("waiter", board.employees);
  const runners = eligibleFor("chips_runner", board.employees);
  const noShift = board.shift === null;

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
              {board.shift ? `Started ${board.shift.startedAt}.` : "No shift is open. Start one to assign staff."}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => (noShift ? run(() => startShiftAction()) : setConfirming(true))}
            className={buttonClasses(noShift ? "primary" : "secondary")}
          >
            {noShift ? "Start shift" : "Start new shift"}
          </button>
        </div>
      </section>

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
        <Modal title="Start a new shift?" onClose={() => setConfirming(false)}>
          <p className="text-lg">
            This ends the current shift, clears every assignment, and starts the seating rotation again at
            A. Seated tables stay as they are.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              disabled={busy}
              className={buttonClasses("primary", "flex-1")}
              onClick={() => run(() => startShiftAction(), () => setConfirming(false))}
            >
              Start new shift
            </button>
            <button type="button" className={buttonClasses("secondary", "flex-1")} onClick={() => setConfirming(false)}>
              Cancel
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
