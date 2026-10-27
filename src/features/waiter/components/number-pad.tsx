"use client";

import { useActionState, useState } from "react";

import { buttonClasses } from "@/components/ui/button";

import { findWaiterAction, type FindWaiterState } from "../actions";
import { cleanTypedNumber } from "../rules";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

const keyClass =
  "flex min-h-16 items-center justify-center rounded-xl border-2 border-glaze bg-paper text-2xl font-bold text-ink hover:border-leaf active:bg-tile disabled:opacity-60";

/** Big on-screen keypad for tablets; a hardware keyboard can type into the field too. */
export function NumberPad() {
  const [state, formAction, pending] = useActionState<FindWaiterState, FormData>(findWaiterAction, { message: null });
  const [value, setValue] = useState("");

  const press = (digit: string) => setValue((current) => cleanTypedNumber(current + digit));

  return (
    <form action={formAction} className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <label htmlFor="employee-number" className="text-lg font-semibold text-ink">
        Your employee number
      </label>
      <input
        id="employee-number"
        name="employeeNumber"
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={state.message ? "employee-number-error" : undefined}
        aria-invalid={state.message ? true : undefined}
        value={value}
        onChange={(event) => setValue(cleanTypedNumber(event.target.value))}
        className="min-h-16 rounded-xl border-2 border-glaze bg-paper px-4 text-center text-3xl font-bold tracking-[0.3em] text-ink focus:border-leaf focus:outline-none"
      />

      <div aria-live="polite">
        {state.message ? (
          <p
            id="employee-number-error"
            role="alert"
            className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger"
          >
            {state.message}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3" role="group" aria-label="Number pad">
        {KEYS.map((digit) => (
          <button key={digit} type="button" className={keyClass} disabled={pending} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" className={`${keyClass} text-lg`} disabled={pending} onClick={() => setValue("")}>
          Clear
        </button>
        <button type="button" className={keyClass} disabled={pending} onClick={() => press("0")}>
          0
        </button>
        <button
          type="button"
          aria-label="Delete last digit"
          className={keyClass}
          disabled={pending}
          onClick={() => setValue((current) => current.slice(0, -1))}
        >
          ⌫
        </button>
      </div>

      <button type="submit" disabled={pending || value === ""} className={buttonClasses("primary", "min-h-16 text-xl")}>
        {pending ? "Looking up…" : "Show my tables"}
      </button>
    </form>
  );
}
