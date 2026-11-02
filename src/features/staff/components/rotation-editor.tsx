"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";

import { setRotationAction } from "../actions";
import { moveInRotation } from "../rules";

type Section = { code: string; name: string };

/** The order being arranged. It follows the saved order until the manager changes something. */
export function useRotationOrder(sections: readonly Section[]) {
  const saved = sections.map((section) => section.code);
  const savedKey = saved.join(",");
  const [shownKey, setShownKey] = useState(savedKey);
  const [order, setOrder] = useState<string[]>(saved);

  if (shownKey !== savedKey) {
    setShownKey(savedKey);
    setOrder(saved);
  }

  return {
    order,
    dirty: order.join(",") !== savedKey,
    move: (code: string, delta: -1 | 1) => setOrder((current) => moveInRotation(current, code, delta)),
    reset: () => setOrder(saved),
  };
}

/** Numbered sections with big up and down buttons (these work the same on a phone, a tablet, and a keyboard). */
export function RotationList({
  sections,
  order,
  onMove,
  disabled,
}: {
  sections: readonly Section[];
  order: readonly string[];
  onMove: (code: string, delta: -1 | 1) => void;
  disabled: boolean;
}) {
  const nameOf = (code: string) => sections.find((section) => section.code === code)?.name ?? code;
  const moveClass =
    "flex size-12 items-center justify-center rounded-lg border border-glaze bg-paper text-xl font-bold text-leaf hover:border-leaf active:scale-95 disabled:opacity-40";

  return (
    <ol aria-label="Seating rotation" className="flex flex-col gap-2">
      {order.map((code, index) => (
        <li key={code} className="flex items-center gap-3 rounded-xl border border-glaze bg-tile px-3 py-1.5" data-testid="rotation-row">
          <span className="w-6 text-center text-lg font-bold tabular-nums text-muted">{index + 1}</span>
          <span className="flex-1 text-lg font-bold text-ink">{nameOf(code)}</span>
          <button
            type="button"
            aria-label={`Move ${nameOf(code)} earlier`}
            disabled={disabled || index === 0}
            onClick={() => onMove(code, -1)}
            className={moveClass}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${nameOf(code)} later`}
            disabled={disabled || index === order.length - 1}
            onClick={() => onMove(code, 1)}
            className={moveClass}
          >
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The open shift's rotation: change the order at any time; the next suggestion follows it. */
export function RotationEditor({ sections, nextSection }: { sections: readonly Section[]; nextSection: string | null }) {
  const { busy, notice, run } = useActionRunner();
  const { order, dirty, move, reset } = useRotationOrder(sections);
  const [next, setNext] = useState<string | null>(null);
  const chosenNext = next ?? nextSection ?? order[0] ?? "";
  const changed = dirty || (next !== null && next !== nextSection);

  return (
    <section aria-labelledby="rotation-heading" className="rounded-2xl border border-glaze bg-paper p-5">
      <h2 id="rotation-heading" className="text-xl font-bold text-ink">
        Seating rotation
      </h2>
      <p className="mt-1 text-sm text-muted">This shift&apos;s order. Party and Bar aren&apos;t in the rotation.</p>
      <div className="mt-3 flex flex-col gap-4">
        <NoticeBanner notice={notice} />
        <RotationList sections={sections} order={order} onMove={move} disabled={busy} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rotation-next" className="text-sm font-semibold text-ink">
            Next party goes to
          </label>
          <select
            id="rotation-next"
            value={chosenNext}
            disabled={busy}
            onChange={(event) => setNext(event.target.value)}
            className="min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none disabled:opacity-60 sm:w-56"
          >
            {order.map((code) => (
              <option key={code} value={code}>
                {sections.find((section) => section.code === code)?.name ?? code}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={busy || !changed}
            className={buttonClasses("primary")}
            onClick={() => run(() => setRotationAction({ rotation: order, nextSection: next }), () => setNext(null))}
          >
            {busy ? "Saving…" : "Save rotation"}
          </button>
          {changed ? (
            <button
              type="button"
              disabled={busy}
              className={buttonClasses("secondary")}
              onClick={() => {
                reset();
                setNext(null);
              }}
            >
              Undo changes
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
