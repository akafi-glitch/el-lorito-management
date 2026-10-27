"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";

import { addEmployeeAction, updateEmployeeAction } from "../actions";
import { ROLE_LABEL, ROLES, type EmployeeRef, type Role } from "../rules";

const selectClass =
  "min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-cobalt focus:outline-none";

/** Add employees, then rename, change role, or turn them on and off. Numbers never change. */
export function EmployeesManager({ employees }: { employees: EmployeeRef[] }) {
  const { busy, notice, run } = useActionRunner();
  const [draft, setDraft] = useState({ number: "", name: "", role: "waiter" as Role });

  return (
    <div className="flex flex-col gap-6">
      <NoticeBanner notice={notice} />

      <section aria-labelledby="add-employee" className="rounded-2xl border border-glaze bg-paper p-5">
        <h2 id="add-employee" className="text-xl font-bold text-ink">
          Add an employee
        </h2>
        <p className="mt-1 text-sm text-muted">
          The number is what they type in the Waiter Section. It can&apos;t be changed later, and 01 and 1 count as
          the same number.
        </p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-[8rem_1fr_12rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => addEmployeeAction(draft), () => setDraft({ number: "", name: "", role: draft.role }));
          }}
        >
          <TextField
            label="Number"
            name="number"
            inputMode="numeric"
            autoComplete="off"
            value={draft.number}
            onChange={(event) => setDraft({ ...draft, number: event.target.value })}
            required
          />
          <TextField
            label="Name"
            name="name"
            autoComplete="off"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-role" className="text-sm font-semibold text-ink">
              Role
            </label>
            <select
              id="new-role"
              className={selectClass}
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy} className={buttonClasses("primary")}>
            Add
          </button>
        </form>
      </section>

      <section aria-labelledby="employee-list" className="rounded-2xl border border-glaze bg-paper p-5">
        <h2 id="employee-list" className="text-xl font-bold text-ink">
          Employees ({employees.length})
        </h2>
        {employees.length === 0 ? (
          <p className="mt-3 text-base text-ink">No employees yet. Add the first one above.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {employees.map((employee) => (
              <EmployeeRow
                key={`${employee.id}-${employee.name}-${employee.role}-${employee.isActive}`}
                employee={employee}
                busy={busy}
                onSave={(changes) => run(() => updateEmployeeAction({ id: employee.id, ...changes }))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmployeeRow({
  employee,
  busy,
  onSave,
}: {
  employee: EmployeeRef;
  busy: boolean;
  onSave: (changes: { name: string; role: Role; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState<Role>(employee.role);
  const changed = name.trim() !== employee.name || role !== employee.role;

  return (
    <li
      className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[4rem_1fr_11rem_auto_auto] sm:items-center ${
        employee.isActive ? "border-glaze" : "border-dashed border-status-closed bg-status-closed/10"
      }`}
    >
      <span className="text-xl font-bold text-ink" aria-label={`Number ${employee.number}`}>
        {employee.number}
      </span>
      <input
        aria-label={`Name for number ${employee.number}`}
        className="min-h-12 rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-cobalt focus:outline-none"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        aria-label={`Role for number ${employee.number}`}
        className={selectClass}
        value={role}
        onChange={(event) => setRole(event.target.value as Role)}
      >
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABEL[option]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !changed}
        className={buttonClasses("primary")}
        onClick={() => onSave({ name, role, isActive: employee.isActive })}
      >
        Save
      </button>
      <button
        type="button"
        disabled={busy}
        className={buttonClasses("secondary")}
        onClick={() => onSave({ name: employee.name, role: employee.role, isActive: !employee.isActive })}
      >
        {employee.isActive ? "Turn off" : "Turn on"}
      </button>
      {!employee.isActive ? (
        <p className="text-sm font-semibold text-ink sm:col-span-5">Turned off: can&apos;t be assigned or sign in to the Waiter Section.</p>
      ) : null}
    </li>
  );
}
