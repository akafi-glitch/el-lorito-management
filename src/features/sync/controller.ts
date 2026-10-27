import { isTopic, movedTopics, newest, type Topic, type Versions } from "./topics";

/**
 * Keeps one screen up to date. Pure logic with everything outside injected, so it is unit tested
 * without a browser:
 * - a live signal for a watched topic, newer than what the screen shows, triggers one refresh
 *   (several signals close together become one refresh);
 * - while the live connection is down, the server's versions are checked every few seconds;
 * - after reconnecting, regaining focus, or coming back online, they are checked once;
 * - while something on screen must not be interrupted (a print question), refreshes wait.
 */

export type LiveStatus = "connecting" | "live" | "catching-up" | "offline";

export type LiveSyncDeps = {
  watched: readonly Topic[];
  /** Versions the screen was drawn with. */
  initial: Versions;
  /** Connects to live signals; returns a function that disconnects. */
  subscribe: (onSignal: (topic: unknown, version: unknown) => void, onConnected: (connected: boolean) => void) => () => void;
  fetchVersions: () => Promise<Versions>;
  refresh: () => void;
  onStatus: (status: LiveStatus) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHeld: () => boolean;
  pollMs?: number;
  debounceMs?: number;
};

export type LiveSync = {
  /** New versions after the screen re-rendered (so the same change isn't refreshed twice). */
  drawn: (versions: Versions) => void;
  /** Check the server now (focus, back online). */
  check: () => void;
  /** A hold on refreshes was released: refresh if something arrived meanwhile. */
  released: () => void;
  stop: () => void;
};

export function startLiveSync(deps: LiveSyncDeps): LiveSync {
  const pollMs = deps.pollMs ?? 5000;
  const debounceMs = deps.debounceMs ?? 250;
  let known: Versions = deps.initial;
  let connected = false;
  let stopped = false;
  let pending = false;
  let refreshTimer: unknown = null;
  let pollTimer: unknown = null;
  let status: LiveStatus = "connecting";

  const setStatus = (next: LiveStatus) => {
    if (next === status) return;
    status = next;
    deps.onStatus(next);
  };

  function refreshSoon() {
    if (stopped) return;
    pending = true;
    if (deps.isHeld() || refreshTimer !== null) return;
    refreshTimer = deps.setTimer(() => {
      refreshTimer = null;
      if (stopped || !pending) return;
      if (deps.isHeld()) return; // released() will pick it up
      pending = false;
      deps.refresh();
    }, debounceMs);
  }

  async function check() {
    if (stopped) return;
    try {
      const latest = await deps.fetchVersions();
      if (stopped) return;
      if (movedTopics(known, latest, deps.watched).length > 0) refreshSoon();
      known = newest(known, latest);
      setStatus(connected ? "live" : "catching-up");
    } catch {
      setStatus("offline");
    }
  }

  function schedulePoll() {
    if (stopped || connected || pollTimer !== null) return;
    pollTimer = deps.setTimer(async () => {
      pollTimer = null;
      await check();
      schedulePoll();
    }, pollMs);
  }

  const unsubscribe = deps.subscribe(
    (topic, version) => {
      if (stopped || !isTopic(topic) || typeof version !== "number" || !deps.watched.includes(topic)) return;
      if (version <= known[topic]) return; // already on screen
      known = { ...known, [topic]: version };
      refreshSoon();
    },
    (isConnected) => {
      if (stopped) return;
      const wasConnected = connected;
      connected = isConnected;
      if (isConnected) {
        if (pollTimer !== null) {
          deps.clearTimer(pollTimer);
          pollTimer = null;
        }
        setStatus("live");
        if (!wasConnected) void check(); // catch anything missed while disconnected
      } else {
        setStatus("catching-up");
        void check();
        schedulePoll();
      }
    },
  );

  // Until the live connection says otherwise, check in the background (covers no-live setups).
  schedulePoll();

  return {
    drawn(versions) {
      known = newest(known, versions);
    },
    check() {
      void check();
    },
    released() {
      if (pending) refreshSoon();
    },
    stop() {
      stopped = true;
      unsubscribe();
      if (refreshTimer !== null) deps.clearTimer(refreshTimer);
      if (pollTimer !== null) deps.clearTimer(pollTimer);
    },
  };
}
