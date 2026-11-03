"use client";

import { useEffect, useId, useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";

import { setRotationAction } from "../actions";
import { placeInRotation } from "../rules";

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
    place: (code: string, place: number) => setOrder((current) => placeInRotation(current, code, place)),
    reset: () => setOrder(saved),
  };
}

/** What a drag needs to remember. The rows stay still in the page during it, so these measurements hold. */
type Drag = { code: string; pointerId: number; startY: number; startPlace: number; place: number; tops: number[]; before: readonly string[] };

/**
 * Numbered sections to drag into order. A mouse can drag a row from anywhere. A finger drags from the
 * handle, so swiping over the list still scrolls the page. On a keyboard, the handle moves with the up and
 * down arrows.
 */
export function RotationList({
  sections,
  order,
  onPlace,
  disabled,
}: {
  sections: readonly Section[];
  order: readonly string[];
  onPlace: (code: string, place: number) => void;
  disabled: boolean;
}) {
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<{ code: string; offset: number; rows: readonly string[] } | null>(null);
  const [moved, setMoved] = useState<{ code: string; place: number } | null>(null);
  const hintId = useId();
  const nameOf = (code: string) => sections.find((section) => section.code === code)?.name ?? code;

  // Moving a row in the page can drop keyboard focus, so put it back on the handle being used.
  useEffect(() => {
    if (moved) list.current?.querySelector<HTMLElement>(`[data-handle="${moved.code}"]`)?.focus();
  }, [moved]);

  function startDrag(event: React.PointerEvent<HTMLLIElement>, code: string) {
    if (disabled || event.button !== 0 || drag.current) return;
    const onHandle = (event.target as Element).closest("[data-handle]") !== null;
    if (event.pointerType !== "mouse" && !onHandle) return;
    const rows = Array.from(list.current?.children ?? []);
    const place = order.indexOf(code);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      code,
      pointerId: event.pointerId,
      startY: event.clientY,
      startPlace: place,
      place,
      tops: rows.map((row) => row.getBoundingClientRect().top),
      before: order,
    };
    setDragging({ code, offset: 0, rows: order });
  }

  function moveDrag(event: React.PointerEvent<HTMLLIElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const { tops } = current;
    const top = Math.min(Math.max(tops[current.startPlace]! + event.clientY - current.startY, tops[0]!), tops[tops.length - 1]!);
    const place = tops.reduce((best, slot, index) => (Math.abs(slot - top) < Math.abs(tops[best]! - top) ? index : best), 0);
    if (place !== current.place) {
      current.place = place;
      onPlace(current.code, place);
    }
    setDragging((shown) => shown && { ...shown, offset: top - tops[place]! });
  }

  function endDrag(event: React.PointerEvent<HTMLLIElement>, keep: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
    if (!keep) onPlace(current.code, current.startPlace);
    else if (current.place !== current.startPlace) setMoved({ code: current.code, place: current.place });
  }

  function pressKey(event: React.KeyboardEvent, code: string, place: number) {
    const to = event.key === "ArrowUp" ? place - 1 : event.key === "ArrowDown" ? place + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= order.length) return;
    onPlace(code, to);
    setMoved({ code, place: to });
  }

  // During a drag the rows keep their place in the page and only look reordered, so the row being dragged is
  // never taken out of the page, which would end the drag.
  return (
    <>
      <span id={hintId} className="sr-only">
        Drag to change the order, or press the up and down arrow keys.
      </span>
      <ol ref={list} aria-label="Seating rotation" className="flex flex-col gap-2">
        {(dragging?.rows ?? order).map((code) => {
          const place = order.indexOf(code);
          const lifted = dragging?.code === code;
          return (
            <li
              key={code}
              data-testid="rotation-row"
              onPointerDown={(event) => startDrag(event, code)}
              onPointerMove={moveDrag}
              onPointerUp={(event) => endDrag(event, true)}
              onPointerCancel={(event) => endDrag(event, false)}
              style={{ order: dragging ? place : undefined, transform: lifted ? `translateY(${dragging.offset}px)` : undefined }}
              className={`flex select-none items-center gap-3 rounded-xl border bg-tile px-3 py-1.5 ${
                lifted ? "relative z-10 cursor-grabbing border-leaf shadow-lg" : `border-glaze ${disabled ? "" : "cursor-grab hover:border-leaf"}`
              }`}
            >
              <span className="w-6 text-center text-lg font-bold tabular-nums text-muted">{place + 1}</span>
              <span className="flex-1 text-lg font-bold text-ink">{nameOf(code)}</span>
              <button
                type="button"
                data-handle={code}
                aria-label={`Move ${nameOf(code)}`}
                aria-describedby={hintId}
                disabled={disabled}
                onKeyDown={(event) => pressKey(event, code, place)}
                className="flex size-12 touch-none cursor-grab items-center justify-center rounded-lg border border-glaze bg-paper text-leaf hover:border-leaf disabled:cursor-default disabled:opacity-40"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="size-5" fill="currentColor">
                  {[3, 8, 13].flatMap((y) => [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {moved ? `${nameOf(moved.code)} is now number ${moved.place + 1}.` : ""}
      </p>
    </>
  );
}

/** The open shift's rotation: change the order at any time; the next suggestion follows it. */
export function RotationEditor({ sections, nextSection }: { sections: readonly Section[]; nextSection: string | null }) {
  const { busy, notice, run } = useActionRunner();
  const { order, dirty, place, reset } = useRotationOrder(sections);
  const [next, setNext] = useState<string | null>(null);
  const chosenNext = next ?? nextSection ?? order[0] ?? "";
  const changed = dirty || (next !== null && next !== nextSection);

  return (
    <section aria-labelledby="rotation-heading" className="rounded-2xl border border-glaze bg-paper p-5">
      <h2 id="rotation-heading" className="text-xl font-bold text-ink">
        Seating rotation
      </h2>
      <p className="mt-1 text-sm text-muted">This shift&apos;s order. Drag to change it. Party and Bar aren&apos;t in the rotation.</p>
      <div className="mt-3 flex flex-col gap-4">
        <NoticeBanner notice={notice} />
        <RotationList sections={sections} order={order} onPlace={place} disabled={busy} />
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
