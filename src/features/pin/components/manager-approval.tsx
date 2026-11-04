"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cleanTypedNumber } from "@/features/waiter/rules";

import { cleanTypedPin, PIN_MIN_DIGITS } from "../rules";

import { pinFieldClass, PinKeypad } from "./pin-keypad";

const OFFLINE = "Couldn't check the PIN. Check the connection and try again.";

type ManagerApprovalProps = {
  title: string;
  /** What is about to happen. */
  text: string;
  confirmLabel: string;
  /** Sends the change with the manager's number and PIN. A message means it didn't happen, and why. */
  submit: (managerNumber: string, pin: string) => Promise<string | null>;
  onClose: () => void;
};

/** A manager gives their employee number and PIN, the same as for Order History, to approve one change. */
export function ManagerApproval({ title, text, confirmLabel, submit, onClose }: ManagerApprovalProps) {
  const [step, setStep] = useState<"number" | "pin">("number");
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPin = step === "pin";
  const value = onPin ? pin : number;
  const set = (next: string) => (onPin ? setPin(cleanTypedPin(next)) : setNumber(cleanTypedNumber(next)));
  const ready = onPin ? pin.length >= PIN_MIN_DIGITS : number !== "";

  async function next(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    if (!onPin) {
      setStep("pin");
      return;
    }
    setBusy(true);
    setMessage(null);
    const typed = pin;
    setPin("");
    try {
      const refused = await submit(number, typed);
      if (refused) setMessage(refused);
    } catch {
      setMessage(OFFLINE);
    }
    setBusy(false);
  }

  return (
    <Modal title={title} onClose={onClose} keepOnOutsideTap>
      <form onSubmit={next} className="flex flex-col gap-4" data-testid="manager-approval">
        <p className="text-base text-ink">{text}</p>
        {onPin ? (
          <>
            <label htmlFor="approval-pin" className="text-lg font-semibold text-ink">
              PIN for manager {number}
            </label>
            <input
              id="approval-pin"
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
            <label htmlFor="approval-number" className="text-lg font-semibold text-ink">
              Manager&apos;s employee number
            </label>
            <input
              id="approval-number"
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
          {message ? (
            <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
              {message}
            </p>
          ) : null}
        </div>

        <PinKeypad value={value} onChange={set} disabled={busy} />

        <button type="submit" disabled={busy || !ready} className={buttonClasses("primary", "min-h-14 text-lg")}>
          {busy ? "Checking…" : onPin ? confirmLabel : "Next"}
        </button>
        <button type="button" disabled={busy} className={buttonClasses("secondary")} onClick={onClose}>
          Keep it
        </button>
      </form>
    </Modal>
  );
}
