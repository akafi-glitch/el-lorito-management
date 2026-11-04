"use client";

import { useActionState, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { cleanTypedNumber } from "@/features/waiter/rules";

import { pinLoginAction, type PinLoginState } from "../actions";
import { cleanTypedPin, PIN_MIN_DIGITS } from "../rules";

import { pinFieldClass, PinKeypad } from "./pin-keypad";

/** Employee number, then PIN, on one big number pad. Whether either is right is only said after both are in. */
export function PinGate({ area }: { area: string }) {
  const [state, formAction, pending] = useActionState<PinLoginState, FormData>(pinLoginAction, { message: null });
  const [step, setStep] = useState<"number" | "pin">("number");
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");

  const onPin = step === "pin";
  const value = onPin ? pin : number;
  const set = (next: string) => (onPin ? setPin(cleanTypedPin(next)) : setNumber(cleanTypedNumber(next)));
  const ready = onPin ? pin.length >= PIN_MIN_DIGITS : number !== "";

  return (
    <section aria-labelledby="pin-heading" className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <div>
        <h2 id="pin-heading" className="text-xl font-bold text-ink">
          {area} is locked
        </h2>
        <p className="mt-1 text-base text-muted">A manager&apos;s employee number and PIN open it.</p>
      </div>

      <form
        action={(formData) => {
          formAction(formData);
          setPin("");
        }}
        onSubmit={(event) => {
          if (!onPin) {
            event.preventDefault();
            if (ready) setStep("pin");
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="employeeNumber" value={number} />
        {onPin ? (
          <>
            <label htmlFor="pin-value" className="text-lg font-semibold text-ink">
              PIN for number {number}
            </label>
            <input
              id="pin-value"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(event) => setPin(cleanTypedPin(event.target.value))}
              className={pinFieldClass}
            />
          </>
        ) : (
          <>
            <label htmlFor="pin-employee" className="text-lg font-semibold text-ink">
              Your employee number
            </label>
            <input
              id="pin-employee"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={number}
              onChange={(event) => setNumber(cleanTypedNumber(event.target.value))}
              className={pinFieldClass}
            />
          </>
        )}

        <div aria-live="polite">
          {state.message ? (
            <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
              {state.message}
            </p>
          ) : null}
        </div>

        <PinKeypad value={value} onChange={set} disabled={pending} />

        <button type="submit" disabled={pending || !ready} className={buttonClasses("primary", "min-h-16 text-xl")}>
          {pending ? "Checking…" : onPin ? "Unlock" : "Next"}
        </button>
        {onPin ? (
          <button
            type="button"
            disabled={pending}
            className={buttonClasses("secondary")}
            onClick={() => {
              setPin("");
              setStep("number");
            }}
          >
            Change number
          </button>
        ) : null}
      </form>
    </section>
  );
}
