"use client";

import "@/lib/zod-config";

import { useEffect, useState } from "react";

import type { MenuData } from "./queries";

/**
 * The menu is about 210 items. Ordering screens fetch it once per menu version and keep it on the
 * device, instead of receiving all of it again every time anything changes in the restaurant, so
 * reloads stay small and moving between tables is instant.
 */
const loaded = new Map<number, MenuData>();
const loading = new Map<number, Promise<MenuData>>();

export function fetchMenuData(version: number): Promise<MenuData> {
  const ready = loaded.get(version);
  if (ready) return Promise.resolve(ready);
  const running = loading.get(version);
  if (running) return running;
  const request = fetch(`/api/menu?v=${version}`, { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`menu ${response.status}`);
      const data = (await response.json()) as MenuData;
      loaded.set(version, data);
      return data;
    })
    .finally(() => loading.delete(version));
  loading.set(version, request);
  return request;
}

export function useMenuData(version: number) {
  const [state, setState] = useState<{ version: number; data: MenuData | null; failed: boolean }>(() => ({
    version,
    data: loaded.get(version) ?? null,
    failed: false,
  }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetchMenuData(version)
      .then((data) => {
        if (current) setState({ version, data, failed: false });
      })
      .catch(() => {
        if (current) setState((previous) => ({ ...previous, version, failed: true }));
      });
    return () => {
      current = false;
    };
  }, [version, attempt]);

  // While a newer version loads, keep showing the older menu.
  return { data: state.data, failed: state.failed && state.data === null, retry: () => setAttempt((n) => n + 1) };
}
