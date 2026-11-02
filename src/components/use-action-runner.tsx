"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { requestRefresh } from "@/features/sync/refresh";
import type { ActionResult } from "@/lib/action-result";

export type Notice = { tone: "ok" | "error"; text: string };

const OFFLINE = "Couldn't reach the server. Check the connection, then try again.";

/**
 * Runs a Server Action with a busy state and a message for staff, then reloads the screen's data in
 * the background. Success messages fade after five seconds; errors stay until the next action.
 */
export function useActionRunner() {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        const result = await action();
        setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
        if (result.ok) onSuccess?.();
        if (!requestRefresh()) router.refresh();
      } catch {
        setNotice({ tone: "error", text: OFFLINE });
      }
    });
  }

  return { busy, notice, run, clearNotice: () => setNotice(null) };
}

export function NoticeBanner({ notice }: { notice: Notice | null }) {
  return (
    <div aria-live="polite">
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border-2 px-4 py-3 text-base font-semibold ${
            notice.tone === "error"
              ? "border-danger bg-danger/10 text-danger"
              : "border-status-vacant bg-status-vacant/10 text-ink"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
