"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClasses } from "@/components/ui/button";
import { GuestCountField } from "@/features/floor/components/guest-count-field";
import { seatPartyAction } from "@/features/seating/actions";

const OFFLINE = "Couldn't reach the server. Check the connection, then try again.";

/** A table with nobody seated yet: seat the group here (the same visit the Floor shows), then order. */
export function SeatHere({ tableCode, tableLabel }: { tableCode: string; tableLabel: string }) {
  const router = useRouter();
  const [guests, setGuests] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startSeating] = useTransition();

  function seat() {
    if (guests === null) return;
    setProblem(null);
    startSeating(async () => {
      try {
        const result = await seatPartyAction({ tableCodes: [tableCode], guestCount: guests, combinationCode: null });
        if (!result.ok) setProblem(result.message);
        router.refresh();
      } catch {
        setProblem(OFFLINE);
      }
    });
  }

  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-4 rounded-2xl border border-glaze bg-paper p-5"
      onSubmit={(event) => {
        event.preventDefault();
        seat();
      }}
    >
      <p className="text-lg text-ink">No guests are seated at {tableLabel} yet. How many guests?</p>
      <label htmlFor="seat-guests" className="text-sm font-semibold text-ink">
        Number of guests
      </label>
      <GuestCountField id="seat-guests" value={guests} onChange={setGuests} />
      {problem ? (
        <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
          {problem}
        </p>
      ) : null}
      <button type="submit" disabled={guests === null || busy} className={buttonClasses("primary", "min-h-14 text-lg")}>
        {busy ? "Seating…" : "Seat and start the order"}
      </button>
      <p className="text-sm text-muted">This shows on the Floor straight away, as a table that needs chips.</p>
    </form>
  );
}
