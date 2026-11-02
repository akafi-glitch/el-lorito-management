"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { historyHref, type HistoryFilters } from "../rules";

const selectClass =
  "min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none disabled:opacity-60";

/** Filter by shift or waiter. Changing one goes to the first page of the new list. */
export function HistoryFilterBar({
  filters,
  shifts,
  waiters,
}: {
  filters: HistoryFilters;
  shifts: { id: number; label: string }[];
  waiters: { number: string; name: string }[];
}) {
  const router = useRouter();
  const [loading, startLoading] = useTransition();

  const go = (change: Partial<HistoryFilters>) => startLoading(() => router.push(historyHref({ ...filters, ...change, page: 1 })));

  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-busy={loading}>
      <div className="flex flex-col gap-1">
        <label htmlFor="history-shift" className="text-sm font-semibold text-ink">
          Shift
        </label>
        <select
          id="history-shift"
          className={selectClass}
          value={filters.shiftId ?? ""}
          onChange={(event) => go({ shiftId: event.target.value === "" ? null : Number(event.target.value) })}
        >
          <option value="">All shifts</option>
          {shifts.map((shift) => (
            <option key={shift.id} value={shift.id}>
              {shift.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="history-waiter" className="text-sm font-semibold text-ink">
          Waiter
        </label>
        <select
          id="history-waiter"
          className={selectClass}
          value={filters.waiterNumber ?? ""}
          onChange={(event) => go({ waiterNumber: event.target.value === "" ? null : event.target.value })}
        >
          <option value="">All waiters</option>
          {waiters.map((waiter) => (
            <option key={waiter.number} value={waiter.number}>
              {waiter.number} {waiter.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="history-sort" className="text-sm font-semibold text-ink">
          Order
        </label>
        <select
          id="history-sort"
          className={selectClass}
          value={filters.oldestFirst ? "oldest" : "newest"}
          onChange={(event) => go({ oldestFirst: event.target.value === "oldest" })}
        >
          <option value="newest">Most recent first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
    </div>
  );
}
