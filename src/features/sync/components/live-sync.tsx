"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

import { startLiveSync, type LiveStatus, type LiveSync as Controller } from "../controller";
import { isRefreshHeld, onHoldReleased } from "../hold";
import { versionsSchema, type Topic, type Versions } from "../topics";

type LiveSyncProps = {
  /** What this screen shows. */
  watch: readonly Topic[];
  /** Versions the server drew this screen with. */
  versions: Versions;
};

/** The private Realtime channel; only active administrators may listen (database policy). */
const CHANNEL = "restaurant";

const LABEL: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  "catching-up": "Reconnecting: checking for changes every few seconds",
  offline: "Offline: changes appear when the connection is back",
};

const DOT: Record<LiveStatus, string> = {
  connecting: "bg-status-closed",
  live: "bg-status-vacant",
  "catching-up": "bg-status-chips",
  offline: "bg-danger",
};

async function fetchVersions(): Promise<Versions> {
  const response = await fetch("/api/changes", { cache: "no-store", headers: { accept: "application/json" } });
  if (response.status === 401 || response.redirected) {
    window.location.reload(); // signed out: the page sends us to sign-in
    throw new Error("signed-out");
  }
  if (!response.ok) throw new Error(`changes ${response.status}`);
  return versionsSchema.parse(await response.json());
}

/**
 * Keeps this screen current across devices: listens for the database's "something changed"
 * signals and reloads the screen's data through the server. Shows a small status dot.
 */
export function LiveSync({ watch, versions }: LiveSyncProps) {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const controller = useRef<Controller | null>(null);
  const watchKey = watch.join(",");

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const live = startLiveSync({
      watched: watchKey.split(",") as Topic[],
      initial: versions,
      subscribe(onSignal, onConnected) {
        let cancelled = false;
        void (async () => {
          try {
            await supabase.realtime.setAuth(); // private channel: send this account's sign-in
          } catch {
            onConnected(false);
            return;
          }
          if (cancelled) return;
          channel = supabase
            .channel(CHANNEL, { config: { private: true } })
            .on("broadcast", { event: "*" }, (message) => onSignal(message.event, (message.payload as { version?: unknown })?.version))
            .subscribe((state) => onConnected(state === "SUBSCRIBED"));
        })();
        return () => {
          cancelled = true;
          if (channel) void supabase.removeChannel(channel);
        };
      },
      fetchVersions,
      refresh: () => router.refresh(),
      onStatus: setStatus,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      isHeld: isRefreshHeld,
    });
    controller.current = live;

    const check = () => live.check();
    const onVisible = () => {
      if (document.visibilityState === "visible") live.check();
    };
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    const stopHold = onHoldReleased(() => live.released());

    return () => {
      live.stop();
      controller.current = null;
      stopHold();
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // The connection is set up once per screen; new versions arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, router]);

  // After every server re-render, the screen shows these versions.
  useEffect(() => {
    controller.current?.drawn(versions);
  }, [versions]);

  return (
    <p className="inline-flex items-center gap-2 text-sm font-semibold text-muted" role="status" aria-live="polite" data-testid="live-status">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT[status]}`} />
      {LABEL[status]}
    </p>
  );
}
