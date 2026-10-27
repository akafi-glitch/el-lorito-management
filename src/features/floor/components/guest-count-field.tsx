"use client";

import { MAX_GUESTS } from "@/features/seating/recommend";

type GuestCountFieldProps = {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  autoFocus?: boolean;
};

const stepButton =
  "flex size-14 shrink-0 items-center justify-center rounded-lg border border-glaze bg-paper text-2xl font-bold text-cobalt hover:border-cobalt disabled:opacity-40";

/** Number of guests with large − / + buttons for quick taps, and a box for typing. */
export function GuestCountField({ id, value, onChange, autoFocus = false }: GuestCountFieldProps) {
  const set = (next: number) => onChange(Math.min(MAX_GUESTS, Math.max(1, next)));

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={stepButton}
        aria-label="One fewer guest"
        disabled={value === null || value <= 1}
        onClick={() => set((value ?? 1) - 1)}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_GUESTS}
        autoFocus={autoFocus}
        value={value ?? ""}
        placeholder="0"
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isNaN(parsed) ? null : Math.min(MAX_GUESTS, Math.max(0, parsed)));
        }}
        className="h-14 w-full min-w-0 rounded-lg border border-glaze bg-paper text-center text-2xl font-bold text-ink focus:border-cobalt focus:outline-none"
      />
      <button
        type="button"
        className={stepButton}
        aria-label="One more guest"
        disabled={value !== null && value >= MAX_GUESTS}
        onClick={() => set((value ?? 0) + 1)}
      >
        +
      </button>
    </div>
  );
}
