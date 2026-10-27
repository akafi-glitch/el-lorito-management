"use client";

import { buttonClasses } from "@/components/ui/button";
import type { SeatingAdvice, SeatingOption } from "@/features/seating/recommend";

import { GuestCountField } from "./guest-count-field";

type NewPartyPanelProps = {
  guestCount: number | null;
  onGuestCountChange: (value: number | null) => void;
  nextSectionName: string | null;
  advice: SeatingAdvice | null;
  onFind: () => void;
  onSeat: (option: SeatingOption) => void;
  busy: boolean;
};

/** Host's starting point: how many guests, then the suggested tables in rotation order. */
export function NewPartyPanel({
  guestCount,
  onGuestCountChange,
  nextSectionName,
  advice,
  onFind,
  onSeat,
  busy,
}: NewPartyPanelProps) {
  const ready = guestCount !== null && guestCount >= 1;

  return (
    <section aria-labelledby="new-party-heading" className="rounded-2xl border border-glaze bg-paper p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="new-party-heading" className="text-xl font-bold text-ink">
          New party
        </h2>
        {nextSectionName ? (
          <p className="text-sm text-muted">
            Next in rotation: <span className="font-bold text-ink">{nextSectionName}</span>
          </p>
        ) : null}
      </div>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onFind();
        }}
      >
        <label htmlFor="party-guests" className="text-sm font-semibold text-ink">
          Number of guests
        </label>
        <GuestCountField id="party-guests" value={guestCount} onChange={onGuestCountChange} />
        <button type="submit" disabled={!ready || busy} className={buttonClasses("primary", "w-full text-lg")}>
          Find a table
        </button>
        <p className="text-sm text-muted">Or tap free tables on the map to seat them yourself.</p>
      </form>

      {advice ? (
        <div className="mt-4 border-t border-glaze pt-4" aria-live="polite">
          {advice.message ? (
            <p className="text-base font-semibold text-ink">{advice.message}</p>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-muted">Suggested for {guestCount} guests</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {advice.options.map((option, index) => (
                  <li
                    key={option.tableCodes.join("+")}
                    className={`rounded-xl border-2 p-3 ${index === 0 ? "border-cobalt" : "border-glaze"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-ink">{option.label}</p>
                        <p className="text-sm text-muted">
                          {option.where}
                          {option.capacity !== null ? `, ${option.capacity} chairs` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSeat(option)}
                        className={buttonClasses(index === 0 ? "primary" : "secondary", "shrink-0")}
                      >
                        Seat here
                      </button>
                    </div>
                    {option.note ? <p className="mt-2 text-sm font-semibold text-ink">{option.note}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
