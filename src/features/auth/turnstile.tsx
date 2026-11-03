"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SignInState } from "./actions";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function Turnstile({
  siteKey,
  token,
  resetAfterError,
  onTokenChange,
}: {
  siteKey: string;
  token: string;
  resetAfterError: SignInState | null;
  onTokenChange: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      size: window.innerWidth < 360 ? "compact" : "flexible",
      theme: "light",
      "response-field": false,
      callback: (token: string) => {
        onTokenChangeRef.current(token);
        setStatus("ready");
      },
      "expired-callback": () => {
        onTokenChangeRef.current("");
        setStatus("ready");
      },
      "error-callback": () => {
        onTokenChangeRef.current("");
        setStatus("error");
      },
      "timeout-callback": () => {
        onTokenChangeRef.current("");
        setStatus("ready");
      },
    });
    setStatus("ready");
  }, [siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [renderWidget]);

  const lastResetAfterError = useRef(resetAfterError);
  useEffect(() => {
    if (lastResetAfterError.current === resetAfterError) return;
    lastResetAfterError.current = resetAfterError;
    if (!resetAfterError) return;
    onTokenChangeRef.current("");
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [resetAfterError]);

  return (
    <div className="rounded-xl border border-glaze bg-tile/50 p-4 max-[359px]:p-3">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={() => setStatus("error")}
      />
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">Security check</span>
        <span aria-live="polite" className={`text-xs font-medium ${token ? "text-leaf-deep" : "text-muted"}`}>
          {token ? "Verified" : status === "error" ? "Unavailable" : "Protected by Cloudflare"}
        </span>
      </div>
      <div ref={containerRef} aria-label="Cloudflare security check" className="min-h-[65px] max-[359px]:min-h-[140px]" />
      {status === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          The security check couldn&apos;t load. Check your connection and reload the page.
        </p>
      )}
    </div>
  );
}
