"use client";

import { buttonClasses } from "@/components/ui/button";

import { GuestCountField } from "./guest-count-field";

type SeatTrayProps = {
  tableLabels: string[];
  chairs: number | null;
  guestCount: number | null;
  onGuestCountChange: (value: number | null) => void;
  onSeat: () => void;
  onCancel: () => void;
  busy: boolean;
};

/**
 * Appears at the bottom while tables are selected on the map. Several tables = one party at joined
 * tables. Asks for the guest count only if the host hasn't entered it already.
 */
export function SeatTray({ tableLabels, chairs, guestCount, onGuestCountChange, onSeat, onCancel, busy }: SeatTrayProps) {
  const ready = guestCount !== null && guestCount >= 1;
  const tooSmall = ready && chairs !== null && guestCount > chairs;

  return (
    <div
      role="region"
      aria-label="Seat selected tables"
      className="fixed inset-x-0 bottom-0 z-20 border-t-4 border-leaf bg-paper shadow-[0_-4px_16px_rgba(29,92,34,0.18)]"
    >
      <form
        className="mx-auto flex max-w-[96rem] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onSeat();
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-ink">
            {tableLabels.length > 1 ? "Join " : "Seat at "}
            {tableLabels.join(" + ")}
          </p>
          <p className={`text-sm ${tooSmall ? "font-semibold text-danger" : "text-muted"}`}>
            {chairs === null ? "Seats not set for every table." : `${chairs} chairs.`}
            {tooSmall ? " Fewer chairs than guests: bring extra chairs or add a table." : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="tray-guests" className="shrink-0 text-sm font-semibold text-ink">
            Guests
          </label>
          <div className="w-56">
            <GuestCountField id="tray-guests" value={guestCount} onChange={onGuestCountChange} autoFocus={!ready} />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={buttonClasses("secondary", "flex-1")}>
            Cancel
          </button>
          <button type="submit" disabled={!ready || busy} className={buttonClasses("primary", "flex-1 text-lg")}>
            {busy ? "Seating…" : "Seat"}
          </button>
        </div>
      </form>
    </div>
  );
}
