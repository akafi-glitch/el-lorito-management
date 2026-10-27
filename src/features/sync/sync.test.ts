import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startLiveSync, type LiveStatus } from "./controller";
import { holdRefresh, isRefreshHeld, onHoldReleased } from "./hold";
import { movedTopics, newest, versionsFromRows, versionsSchema, type Versions } from "./topics";

const V0: Versions = { floor: 10, staff: 5, menu: 3, tickets: 7 };

describe("versions", () => {
  it("reads database rows; a missing topic counts as 0", () => {
    expect(versionsFromRows([{ topic: "floor", version: 4 }, { topic: "menu", version: 2 }])).toEqual({ floor: 4, staff: 0, menu: 2, tickets: 0 });
  });

  it("finds the watched topics that moved", () => {
    expect(movedTopics(V0, { ...V0, floor: 11, menu: 9 }, ["floor", "staff"])).toEqual(["floor"]);
    expect(movedTopics(V0, V0, ["floor", "staff", "menu", "tickets"])).toEqual([]);
  });

  it("keeps the newest of each topic", () => {
    expect(newest(V0, { floor: 9, staff: 6, menu: 3, tickets: 8 })).toEqual({ floor: 10, staff: 6, menu: 3, tickets: 8 });
  });

  it("checks what the server sends", () => {
    expect(versionsSchema.safeParse(V0).success).toBe(true);
    expect(versionsSchema.safeParse({ floor: "1" }).success).toBe(false);
  });
});

/** A screen wired to fakes: we play the live connection and the server. */
function harness(options: { watched?: ("floor" | "staff" | "menu" | "tickets")[]; held?: () => boolean } = {}) {
  let signal: (topic: unknown, version: unknown) => void = () => {};
  let connected: (on: boolean) => void = () => {};
  let server: Versions = V0;
  let serverDown = false;
  const statuses: LiveStatus[] = [];
  const refresh = vi.fn();
  const unsubscribe = vi.fn();
  const fetchVersions = vi.fn(async () => {
    if (serverDown) throw new Error("offline");
    return server;
  });
  const live = startLiveSync({
    watched: options.watched ?? ["floor", "staff"],
    initial: V0,
    subscribe(onSignal, onConnected) {
      signal = onSignal;
      connected = onConnected;
      return unsubscribe;
    },
    fetchVersions,
    refresh,
    onStatus: (status) => statuses.push(status),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isHeld: options.held ?? (() => false),
    pollMs: 5000,
    debounceMs: 250,
  });
  return {
    live,
    refresh,
    fetchVersions,
    statuses,
    unsubscribe,
    signal: (topic: unknown, version: unknown) => signal(topic, version),
    connect: (on: boolean) => connected(on),
    setServer: (versions: Versions) => (server = versions),
    setServerDown: (down: boolean) => (serverDown = down),
  };
}

describe("live updates on one screen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes once when another device changes the floor", async () => {
    const h = harness();
    h.connect(true);
    await vi.runOnlyPendingTimersAsync();
    h.signal("floor", 11);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("turns several changes close together into one refresh", async () => {
    const h = harness();
    h.connect(true);
    h.signal("floor", 11);
    h.signal("floor", 12);
    h.signal("staff", 6);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores topics this screen doesn't show, old versions, and junk", async () => {
    const h = harness({ watched: ["floor"] });
    h.connect(true);
    h.signal("menu", 99);
    h.signal("floor", 10); // already on screen
    h.signal("floor", 9);
    h.signal("orders", 50);
    h.signal("floor", "11");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("doesn't refresh twice for a change the screen already shows", async () => {
    const h = harness();
    h.connect(true);
    h.live.drawn({ ...V0, floor: 11 }); // our own action already re-drew the floor
    h.signal("floor", 11);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("when the live connection drops, checks the server every 5 seconds and refreshes on a change", async () => {
    const h = harness();
    h.connect(true);
    h.connect(false);
    expect(h.statuses.at(-1)).toBe("catching-up");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.refresh).not.toHaveBeenCalled();
    h.setServer({ ...V0, staff: 6 });
    await vi.advanceTimersByTimeAsync(5300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("doesn't poll while live", async () => {
    const h = harness();
    h.connect(true);
    await vi.advanceTimersByTimeAsync(1); // the catch-up check right after connecting
    const calls = h.fetchVersions.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchVersions.mock.calls.length).toBe(calls);
  });

  it("catches up once after reconnecting (changes made while disconnected)", async () => {
    const h = harness();
    h.connect(false);
    await vi.advanceTimersByTimeAsync(1);
    h.setServer({ ...V0, floor: 15 });
    h.connect(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toBe("live");
  });

  it("works with no live connection at all (keeps checking)", async () => {
    const h = harness();
    h.setServer({ ...V0, floor: 12 });
    await vi.advanceTimersByTimeAsync(5300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("says offline when the server can't be reached, and recovers", async () => {
    const h = harness();
    h.connect(false);
    h.setServerDown(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.statuses.at(-1)).toBe("offline");
    h.setServerDown(false);
    h.setServer({ ...V0, floor: 20 });
    await vi.advanceTimersByTimeAsync(5300);
    expect(h.statuses.at(-1)).toBe("catching-up");
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("checks on demand (focus, back online)", async () => {
    const h = harness();
    h.connect(true);
    h.setServer({ ...V0, staff: 9 });
    h.live.check();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("waits while held (a print question is open), then refreshes once", async () => {
    let held = true;
    const h = harness({ held: () => held });
    h.connect(true);
    h.signal("floor", 11);
    h.signal("floor", 12);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.refresh).not.toHaveBeenCalled();
    held = false;
    h.live.released();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("stops cleanly: disconnects and never refreshes afterwards", async () => {
    const h = harness();
    h.connect(true);
    h.signal("floor", 11);
    h.live.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("holding refreshes", () => {
  it("counts holds and tells listeners when the last one is released", () => {
    const listener = vi.fn();
    const stop = onHoldReleased(listener);
    const a = holdRefresh();
    const b = holdRefresh();
    expect(isRefreshHeld()).toBe(true);
    a();
    a(); // releasing twice does nothing
    expect(isRefreshHeld()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    b();
    expect(isRefreshHeld()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
