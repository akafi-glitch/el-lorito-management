/**
 * "This device just changed something: reload the screen's data." Goes through the screen's LiveSync
 * when it has one, so a change's own refresh and its live signal become one reload, not two.
 */
let handler: (() => void) | null = null;

export function setRefreshHandler(next: (() => void) | null): void {
  handler = next;
}

/** Returns false when no LiveSync is listening (the caller refreshes by itself). */
export function requestRefresh(): boolean {
  if (!handler) return false;
  handler();
  return true;
}
