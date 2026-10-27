/**
 * "Don't refresh right now": a print question on screen must not be swapped away by a refresh.
 * Anyone can hold; refreshes wait until every hold is released.
 */
let holds = 0;
const listeners = new Set<() => void>();

export function holdRefresh(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) for (const listener of listeners) listener();
  };
}

export function isRefreshHeld(): boolean {
  return holds > 0;
}

/** Called whenever the last hold is released. */
export function onHoldReleased(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
