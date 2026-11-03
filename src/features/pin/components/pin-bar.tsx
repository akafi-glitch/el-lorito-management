"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { buttonClasses } from "@/components/ui/button";

import { lockPinSessionAction, touchPinSessionAction } from "../actions";
import { IDLE_LIMIT_MS } from "../rules";

const TOUCH_EVERY_MS = 30_000;
const LOOK_EVERY_MS = 15_000;

/**
 * Who unlocked this page, and Lock. It also keeps the session honest: only real taps, keys, and scrolling
 * count as activity, never this page refreshing itself, and the page locks itself when time is up.
 */
export function PinBar({ name, employeeNumber, expiresAtMs }: { name: string; employeeNumber: string; expiresAtMs: number }) {
  const router = useRouter();

  useEffect(() => {
    let lastActivity = Date.now();
    let lastTouch = 0;
    let waiting = false;

    function touch() {
      lastTouch = Date.now();
      waiting = false;
      touchPinSessionAction()
        .then((stillGood) => {
          if (!stillGood) router.refresh();
        })
        .catch(() => {}); // offline: the next look tries again
    }
    function activity() {
      lastActivity = Date.now();
      if (lastActivity - lastTouch >= TOUCH_EVERY_MS) touch();
      else waiting = true;
    }

    touch(); // also catches this page coming back with the Back button after Lock
    const events = ["pointerdown", "keydown", "scroll"] as const;
    for (const event of events) window.addEventListener(event, activity, { passive: true });
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastActivity >= IDLE_LIMIT_MS || now >= expiresAtMs) router.refresh();
      else if (waiting && now - lastTouch >= TOUCH_EVERY_MS) touch();
    }, LOOK_EVERY_MS);

    return () => {
      for (const event of events) window.removeEventListener(event, activity);
      clearInterval(timer);
    };
  }, [router, expiresAtMs]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-glaze bg-paper px-4 py-3 print:hidden" data-testid="pin-bar">
      <p className="text-base text-ink">
        <span className="text-muted">Unlocked by </span>
        <span className="font-semibold">
          {name} ({employeeNumber})
        </span>
      </p>
      <form action={lockPinSessionAction}>
        <button type="submit" className={buttonClasses("secondary")}>
          Lock
        </button>
      </form>
    </div>
  );
}
