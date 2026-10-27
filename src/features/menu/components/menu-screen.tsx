"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { TotalsBlock } from "@/features/billing/components/totals-block";
import type { TaxSetup } from "@/features/billing/setup";
import { computeTotals, type TaxGroup } from "@/features/billing/tax";

import { formatCents } from "../money";
import { addItem, priceDraft, quantityOf, removeItem, setQuantity, MAX_QUANTITY, type Draft } from "../order-draft";
import { currentPriceCents, formatTimeOfDay, isLate } from "../pricing";
import { searchMenu } from "../search";
import type { Menu, MenuCategory, MenuItem } from "../types";

type MenuScreenProps = {
  menu: Menu;
  timeZone: string;
  /** Server time when the page was made, so the first render matches on server and device. */
  nowIso: string;
  /** The order being built; the parent owns it (it may come from a saved ticket). */
  draft: Draft;
  onDraftChange: (update: (current: Draft) => Draft) => void;
  /** Lines already saved on the ticket keep their saved name and price. */
  savedLines?: ReadonlyMap<number, { name: string; unitCents: number; taxGroup: TaxGroup }>;
  /** Tax rates and groups from the database, for the totals preview. */
  tax: TaxSetup;
  /** Heading of the order panel, e.g. "New ticket" or "Ticket #1001". */
  orderTitle: string;
  /** Buttons and status under the order total (save, cancel...). */
  orderFooter: ReactNode;
};

/** Pick a category or search, tap items to add them, adjust quantities in the order panel. */
export function MenuScreen({
  menu,
  timeZone,
  nowIso,
  draft,
  onDraftChange: setDraft,
  savedLines,
  tax,
  orderTitle,
  orderFooter,
}: MenuScreenProps) {
  const [now, setNow] = useState(() => new Date(nowIso));
  const [categoryId, setCategoryId] = useState<number | null>(menu.categories[0]?.id ?? null);
  const [query, setQuery] = useState("");

  // Re-check the clock every 30 seconds so lunch prices change at 3:00 PM without a reload.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const lookup = useMemo(() => {
    const byId = new Map<number, { item: MenuItem; category: MenuCategory }>();
    for (const category of menu.categories) for (const item of category.items) byId.set(item.id, { item, category });
    return byId;
  }, [menu]);

  const priceOf = (item: MenuItem, category: MenuCategory) => currentPriceCents(item.priceCents, category.late, now, timeZone);
  const order = priceDraft(draft, (itemId) => {
    const saved = savedLines?.get(itemId);
    if (saved) return saved;
    const found = lookup.get(itemId);
    return found
      ? { name: found.item.name, unitCents: priceOf(found.item, found.category), taxGroup: tax.groupOf[found.item.taxCategory] }
      : undefined;
  });
  const totals = computeTotals(order.lines, tax.rates);

  const searching = query.trim() !== "";
  const hits = searching ? searchMenu(menu.categories, query) : [];
  const category = menu.categories.find((c) => c.id === categoryId) ?? null;
  const shown = searching ? hits : (category?.items.map((item) => ({ item, category })) ?? []);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <section aria-labelledby="menu-heading" className="flex min-w-0 flex-col gap-4">
        <h2 id="menu-heading" className="sr-only">
          Menu
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="menu-search" className="text-sm font-semibold text-ink">
            Search the menu
          </label>
          <div className="flex gap-2">
            <input
              id="menu-search"
              type="search"
              autoComplete="off"
              placeholder="For example: combo 5, fajitas, margarita"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-12 min-w-0 flex-1 rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="min-h-12 rounded-lg border border-glaze bg-paper px-4 font-semibold text-leaf hover:border-leaf"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <nav aria-label="Menu categories" className="-mx-1 overflow-x-auto px-1 pb-1">
          <ul className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
            {menu.categories.map((c) => {
              const current = !searching && c.id === categoryId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={current}
                    onClick={() => {
                      setCategoryId(c.id);
                      setQuery("");
                    }}
                    className={`min-h-12 whitespace-nowrap rounded-full px-4 text-base font-semibold ${
                      current ? "bg-leaf text-white" : "border border-glaze bg-paper text-leaf hover:border-leaf"
                    }`}
                  >
                    {c.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div>
          {searching ? (
            <p className="text-base font-semibold text-ink" aria-live="polite">
              {hits.length === 0 ? `Nothing matches “${query.trim()}”.` : `${hits.length} ${hits.length === 1 ? "item matches" : "items match"}`}
            </p>
          ) : category ? (
            <div>
              <h3 className="text-xl font-bold text-ink">{category.name}</h3>
              {category.note ? <p className="text-sm text-muted">{category.note}</p> : null}
              {category.late && isLate(category.late, now, timeZone) ? (
                <p className="mt-1 text-sm font-semibold text-ink">
                  After {formatTimeOfDay(category.late.fromMinutes)}: prices include {formatCents(category.late.surchargeCents)} extra.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(({ item, category: itemCategory }) => (
            <li key={item.id}>
              <ItemButton
                item={item}
                categoryName={searching ? itemCategory.name : null}
                priceCents={priceOf(item, itemCategory)}
                lateLabel={itemCategory.late && isLate(itemCategory.late, now, timeZone) ? `After ${formatTimeOfDay(itemCategory.late.fromMinutes)} price` : null}
                inOrder={quantityOf(draft, item.id)}
                onAdd={() => setDraft((current) => addItem(current, item.id))}
              />
            </li>
          ))}
        </ul>
      </section>

      <section
        id="current-order"
        aria-labelledby="order-heading"
        className="rounded-2xl border border-glaze bg-paper p-4 sm:p-5 lg:sticky lg:top-4"
      >
        <h2 id="order-heading" className="text-xl font-bold text-ink">
          {orderTitle} {order.itemCount > 0 ? `(${order.itemCount})` : ""}
        </h2>
        {order.lines.length === 0 ? (
          <p className="mt-3 text-base text-muted">Tap menu items to add them.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-glaze">
            {order.lines.map((line) => (
              <li key={line.itemId} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-ink">{line.name}</span>
                  <span className="font-semibold tabular-nums text-ink">{formatCents(line.totalCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2" role="group" aria-label={`Quantity of ${line.name}`}>
                    <button
                      type="button"
                      aria-label={`One fewer ${line.name}`}
                      disabled={line.quantity <= 1}
                      onClick={() => setDraft((current) => setQuantity(current, line.itemId, line.quantity - 1))}
                      className="flex size-12 items-center justify-center rounded-lg border border-glaze text-2xl font-bold text-leaf hover:border-leaf disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-lg font-bold tabular-nums text-ink" aria-live="polite">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`One more ${line.name}`}
                      disabled={line.quantity >= MAX_QUANTITY}
                      onClick={() => setDraft((current) => setQuantity(current, line.itemId, line.quantity + 1))}
                      className="flex size-12 items-center justify-center rounded-lg border border-glaze text-2xl font-bold text-leaf hover:border-leaf disabled:opacity-40"
                    >
                      +
                    </button>
                    <span className="text-sm text-muted">× {formatCents(line.unitCents)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    onClick={() => setDraft((current) => removeItem(current, line.itemId))}
                    className="min-h-12 rounded-lg px-3 font-semibold text-danger hover:bg-danger/10"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 border-t-2 border-ink/20 pt-3">
          <TotalsBlock totals={totals} />
        </div>
        <div className="mt-4">{orderFooter}</div>
      </section>

      {order.itemCount > 0 ? (
        <a
          href="#current-order"
          className="sticky bottom-3 z-10 flex min-h-14 items-center justify-between rounded-xl bg-leaf px-5 text-lg font-bold text-white shadow-lg lg:hidden"
        >
          <span>View order ({order.itemCount})</span>
          <span className="tabular-nums">{formatCents(totals.totalCents)}</span>
        </a>
      ) : null}
    </div>
  );
}

function ItemButton({
  item,
  categoryName,
  priceCents,
  lateLabel,
  inOrder,
  onAdd,
}: {
  item: MenuItem;
  categoryName: string | null;
  priceCents: number;
  lateLabel: string | null;
  inOrder: number;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!item.isAvailable}
      onClick={onAdd}
      aria-label={`Add ${item.name}, ${formatCents(priceCents)}${inOrder > 0 ? `, ${inOrder} in order` : ""}${item.isAvailable ? "" : ", not available"}`}
      className={`flex h-full min-h-20 w-full flex-col gap-1 rounded-xl border-2 p-3 text-left ${
        inOrder > 0 ? "border-leaf bg-leaf/5" : "border-glaze bg-paper hover:border-leaf"
      } disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-60`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-bold text-ink">{item.name}</span>
        <span className="shrink-0 font-bold tabular-nums text-ink">{formatCents(priceCents)}</span>
      </span>
      {categoryName ? <span className="text-xs font-semibold text-muted">{categoryName}</span> : null}
      {item.description ? <span className="line-clamp-2 text-sm text-muted">{item.description}</span> : null}
      <span className="mt-auto flex flex-wrap gap-2 text-xs font-semibold">
        {lateLabel ? <span className="rounded bg-status-chips/30 px-1.5 py-0.5 text-ink">{lateLabel}</span> : null}
        {!item.isAvailable ? <span className="rounded bg-status-closed/30 px-1.5 py-0.5 text-ink">Not available</span> : null}
        {inOrder > 0 ? <span className="rounded bg-leaf px-1.5 py-0.5 text-white">{inOrder} in order</span> : null}
      </span>
    </button>
  );
}
