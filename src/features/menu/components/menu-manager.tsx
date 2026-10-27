"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";

import { updateMenuItemAction } from "../actions";
import { formatCents, parseDollars } from "../money";
import { formatTimeOfDay } from "../pricing";
import { searchMenu } from "../search";
import type { Menu, MenuItem } from "../types";

const TAX_LABEL = { food: "Food", nonalcoholic: "Nonalcoholic drink", beer: "Beer", cocktail: "Cocktail" } as const;

/** Change prices and turn items on or off. New prices apply to new tickets only. */
export function MenuManager({ menu }: { menu: Menu }) {
  const { busy, notice, run } = useActionRunner();
  const [categoryId, setCategoryId] = useState<number>(menu.categories[0]?.id ?? 0);
  const [query, setQuery] = useState("");

  const searching = query.trim() !== "";
  const category = menu.categories.find((c) => c.id === categoryId);
  const rows = searching
    ? searchMenu(menu.categories, query).map((hit) => ({ item: hit.item, categoryName: hit.category.name }))
    : (category?.items.map((item) => ({ item, categoryName: null })) ?? []);
  const offCount = menu.categories.reduce((sum, c) => sum + c.items.filter((item) => !item.isAvailable).length, 0);

  return (
    <div className="flex flex-col gap-6">
      <NoticeBanner notice={notice} />

      <section aria-labelledby="menu-tools" className="rounded-2xl border border-glaze bg-paper p-5">
        <h2 id="menu-tools" className="text-xl font-bold text-ink">
          Menu prices and availability
        </h2>
        <p className="mt-1 text-sm text-muted">
          A new price applies to new tickets only; tickets already made keep their prices. Turned-off items stay on the
          waiter&apos;s menu greyed out. {offCount > 0 ? `${offCount} turned off now.` : null}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="menu-category" className="text-sm font-semibold text-ink">
              Category
            </label>
            <select
              id="menu-category"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(Number(event.target.value));
                setQuery("");
              }}
              className="min-h-12 rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-cobalt focus:outline-none"
            >
              {menu.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.items.length})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="menu-manage-search" className="text-sm font-semibold text-ink">
              Or search all items
            </label>
            <input
              id="menu-manage-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-12 rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-cobalt focus:outline-none"
            />
          </div>
        </div>
        {!searching && category?.late ? (
          <p className="mt-3 text-sm font-semibold text-ink">
            {category.name}: from {formatTimeOfDay(category.late.fromMinutes)} each item costs{" "}
            {formatCents(category.late.surchargeCents)} more. The prices below are the before-{formatTimeOfDay(category.late.fromMinutes)} prices.
          </p>
        ) : null}
      </section>

      <ul className="flex flex-col gap-3" aria-label="Menu items">
        {rows.map(({ item, categoryName }) => (
          <ItemRow
            key={`${item.id}-${item.priceCents}-${item.isAvailable}`}
            item={item}
            categoryName={categoryName}
            busy={busy}
            onSave={(price, isAvailable) => run(() => updateMenuItemAction({ id: item.id, price, isAvailable }))}
          />
        ))}
        {searching && rows.length === 0 ? <li className="text-base text-ink">Nothing matches.</li> : null}
      </ul>
    </div>
  );
}

function ItemRow({
  item,
  categoryName,
  busy,
  onSave,
}: {
  item: MenuItem;
  categoryName: string | null;
  busy: boolean;
  onSave: (price: string, isAvailable: boolean) => void;
}) {
  const [price, setPrice] = useState((item.priceCents / 100).toFixed(2));
  const typed = parseDollars(price);
  const changed = typed !== null && typed !== item.priceCents;

  return (
    <li
      className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_8rem_auto_auto] sm:items-center ${
        item.isAvailable ? "border-glaze bg-paper" : "border-dashed border-status-closed bg-status-closed/10"
      }`}
    >
      <div className="min-w-0">
        <p className="font-bold text-ink">{item.name}</p>
        <p className="text-sm text-muted">
          {categoryName ? `${categoryName} · ` : ""}
          {TAX_LABEL[item.taxCategory]}
          {item.isAvailable ? "" : " · Turned off"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-lg font-semibold text-ink" aria-hidden="true">
          $
        </span>
        <input
          aria-label={`Price of ${item.name} in dollars`}
          inputMode="decimal"
          autoComplete="off"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-invalid={typed === null ? true : undefined}
          className="min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base tabular-nums text-ink focus:border-cobalt focus:outline-none aria-[invalid=true]:border-danger"
        />
      </div>
      <button
        type="button"
        disabled={busy || !changed}
        className={buttonClasses("primary")}
        onClick={() => onSave(price, item.isAvailable)}
      >
        Save price
      </button>
      <button
        type="button"
        disabled={busy}
        className={buttonClasses("secondary")}
        onClick={() => onSave((item.priceCents / 100).toFixed(2), !item.isAvailable)}
      >
        {item.isAvailable ? "Turn off" : "Turn on"}
      </button>
    </li>
  );
}
