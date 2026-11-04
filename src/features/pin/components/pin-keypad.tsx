"use client";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

const keyClass =
  "flex min-h-16 items-center justify-center rounded-xl border-2 border-glaze bg-paper text-2xl font-bold text-ink hover:border-leaf active:bg-tile disabled:opacity-60";

export const pinFieldClass =
  "min-h-16 w-full rounded-xl border-2 border-glaze bg-paper px-4 text-center text-3xl font-bold tracking-[0.3em] text-ink focus:border-leaf focus:outline-none";

/** The big number pad for employee numbers and PINs. */
export function PinKeypad({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3" role="group" aria-label="Number pad">
      {KEYS.map((digit) => (
        <button key={digit} type="button" className={keyClass} disabled={disabled} onClick={() => onChange(value + digit)}>
          {digit}
        </button>
      ))}
      <button type="button" className={`${keyClass} text-lg`} disabled={disabled} onClick={() => onChange("")}>
        Clear
      </button>
      <button type="button" className={keyClass} disabled={disabled} onClick={() => onChange(`${value}0`)}>
        0
      </button>
      <button type="button" aria-label="Delete last digit" className={keyClass} disabled={disabled} onClick={() => onChange(value.slice(0, -1))}>
        ⌫
      </button>
    </div>
  );
}
