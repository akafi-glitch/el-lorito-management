"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";
import type { ActionResult } from "@/lib/action-result";

import { addMenuItemAction, addMenuOptionAction, editMenuItemAction, removeMenuItemAction, updateMenuItemAction } from "../actions";
import { formatCents, parseDollars } from "../money";
import { formatTimeOfDay } from "../pricing";
import { TAX_CATEGORIES, TAX_CATEGORY_LABEL } from "../schema";
import { searchMenu } from "../search";
import type { Menu, MenuCategory, MenuItem, TaxCategory } from "../types";

const TAX_LABEL = { food: "Food", nonalcoholic: "Nonalcoholic drink", beer: "Beer", cocktail: "Cocktail" } as const;
const FIELD = "min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none";
const LABEL = "text-sm font-semibold text-ink";

type Run = (action: () => Promise<ActionResult>, onSuccess?: () => void) => void;

/**
 * The manager's menu: add items, change their name, description, price, and tax, turn them on or off, give them
 * options that waiters choose from (such as Beef or Chicken), and take them off the menu. Changes reach the waiters'
 * menus at once; tickets already made keep their own names and prices.
 */
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
          Menu
        </h2>
        <p className="mt-1 text-sm text-muted">
          Add items, change them, and give them options that waiters choose from, such as Beef or Chicken. Changes reach
          the waiters at once; tickets already made keep their names and prices. Turned-off items stay on the
          waiter&apos;s menu greyed out. {offCount > 0 ? `${offCount} turned off now.` : null}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="menu-category" className={LABEL}>
              Category
            </label>
            <select
              id="menu-category"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(Number(event.target.value));
                setQuery("");
              }}
              className={FIELD}
            >
              {menu.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.items.length})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="menu-manage-search" className={LABEL}>
              Or search all items
            </label>
            <input
              id="menu-manage-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={FIELD}
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

      {!searching && category ? <AddItemForm key={category.id} category={category} busy={busy} run={run} /> : null}

      <ul className="flex flex-col gap-3" aria-label="Menu items">
        {rows.map(({ item, categoryName }) => (
          <ItemRow
            key={`${item.id}-${item.name}-${item.description}-${item.priceCents}-${item.taxCategory}-${item.isAvailable}`} // not the options: adding one keeps the editor open
            item={item}
            categoryName={categoryName}
            busy={busy}
            run={run}
          />
        ))}
        {searching && rows.length === 0 ? <li className="text-base text-ink">Nothing matches.</li> : null}
      </ul>
    </div>
  );
}

/** A new item at the end of the chosen page. */
function AddItemForm({ category, busy, run }: { category: MenuCategory; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [taxCategory, setTaxCategory] = useState<TaxCategory | "">("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "self-start border-2 border-dashed border-leaf")}>
        Add an item to {category.name}
      </button>
    );
  }

  return (
    <form
      aria-labelledby="add-item-heading"
      className="flex flex-col gap-4 rounded-2xl border-2 border-leaf bg-paper p-5"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => addMenuItemAction({ categoryId: category.id, name, description, price, taxCategory: taxCategory as TaxCategory }),
          () => {
            setName("");
            setDescription("");
            setPrice("");
            setTaxCategory("");
            setOpen(false);
          },
        );
      }}
    >
      <h3 id="add-item-heading" className="text-lg font-bold text-ink">
        New item on {category.name}
      </h3>
      <ItemFields
        idPrefix="new-item"
        name={name}
        description={description}
        price={price}
        taxCategory={taxCategory}
        onName={setName}
        onDescription={setDescription}
        onPrice={setPrice}
        onTaxCategory={setTaxCategory}
      />
      <p className="text-sm text-muted">To have waiters choose, such as Beef or Chicken, add options after the item is saved.</p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={buttonClasses("primary")}>
          Add item
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClasses("quiet")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemFields({
  idPrefix,
  name,
  description,
  price,
  taxCategory,
  onName,
  onDescription,
  onPrice,
  onTaxCategory,
}: {
  idPrefix: string;
  name: string;
  description: string;
  price: string;
  taxCategory: TaxCategory | "";
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onPrice: (value: string) => void;
  onTaxCategory: (value: TaxCategory | "") => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={`${idPrefix}-name`} className={LABEL}>
          Name
        </label>
        <input id={`${idPrefix}-name`} maxLength={80} autoComplete="off" value={name} onChange={(e) => onName(e.target.value)} className={FIELD} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={`${idPrefix}-description`} className={LABEL}>
          Description (optional)
        </label>
        <textarea
          id={`${idPrefix}-description`}
          maxLength={400}
          rows={2}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          className={`${FIELD} py-2`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-price`} className={LABEL}>
          Price in dollars
        </label>
        <input
          id={`${idPrefix}-price`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="8.25"
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          aria-invalid={price !== "" && parseDollars(price) === null ? true : undefined}
          className={`${FIELD} tabular-nums aria-[invalid=true]:border-danger`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-tax`} className={LABEL}>
          Tax type
        </label>
        <select id={`${idPrefix}-tax`} value={taxCategory} onChange={(e) => onTaxCategory(e.target.value as TaxCategory | "")} className={FIELD}>
          <option value="">Choose…</option>
          {TAX_CATEGORIES.map((code) => (
            <option key={code} value={code}>
              {TAX_CATEGORY_LABEL[code]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ItemRow({ item, categoryName, busy, run }: { item: MenuItem; categoryName: string | null; busy: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [price, setPrice] = useState((item.priceCents / 100).toFixed(2));
  const [taxCategory, setTaxCategory] = useState<TaxCategory | "">(item.taxCategory);
  const [option, setOption] = useState("");
  const [confirming, setConfirming] = useState<{ id: number; name: string } | null>(null);
  const idPrefix = `item-${item.id}`;

  return (
    <li
      className={`flex flex-col gap-3 rounded-xl border p-3 ${
        item.isAvailable ? "border-glaze bg-paper" : "border-dashed border-status-closed bg-status-closed/10"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">
            {item.name} <span className="tabular-nums">{formatCents(item.priceCents)}</span>
          </p>
          <p className="text-sm text-muted">
            {categoryName ? `${categoryName} · ` : ""}
            {TAX_LABEL[item.taxCategory]}
            {item.isAvailable ? "" : " · Turned off"}
          </p>
          {item.description ? <p className="text-sm text-muted">{item.description}</p> : null}
          {item.choices.length > 0 ? (
            <p className="text-sm font-semibold text-ink">Options: {item.choices.map((choice) => choice.choiceLabel).join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)} className={buttonClasses("secondary")}>
            {editing ? "Close" : "Edit"}
            <span className="sr-only"> {item.name}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            className={buttonClasses("secondary")}
            onClick={() => run(() => updateMenuItemAction({ id: item.id, price: (item.priceCents / 100).toFixed(2), isAvailable: !item.isAvailable }))}
          >
            {item.isAvailable ? "Turn off" : "Turn on"}
            <span className="sr-only"> {item.name}</span>
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-5 border-t border-glaze pt-4">
          <form
            className="flex flex-col gap-4"
            aria-label={`Change ${item.name}`}
            onSubmit={(event) => {
              event.preventDefault();
              run(() =>
                editMenuItemAction({ id: item.id, name, description, price, taxCategory: taxCategory as TaxCategory, isAvailable: item.isAvailable }),
              );
            }}
          >
            <ItemFields
              idPrefix={idPrefix}
              name={name}
              description={description}
              price={price}
              taxCategory={taxCategory}
              onName={setName}
              onDescription={setDescription}
              onPrice={setPrice}
              onTaxCategory={setTaxCategory}
            />
            <button type="submit" disabled={busy} className={buttonClasses("primary", "self-start")}>
              Save changes
            </button>
          </form>

          <section aria-labelledby={`${idPrefix}-options`} className="flex flex-col gap-3">
            <h4 id={`${idPrefix}-options`} className="font-bold text-ink">
              Options waiters choose from
            </h4>
            {item.choices.length === 0 ? (
              <p className="text-sm text-muted">None: waiters add it with one tap. Add two or more, such as Beef and Chicken, to have them choose.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {item.choices.map((choice, index) => (
                  <li key={choice.id} className="flex items-center justify-between gap-3 rounded-lg border border-glaze px-3 py-2">
                    <span className="font-semibold text-ink">
                      {index + 1}. {choice.choiceLabel}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming({ id: choice.id, name: `the option ${choice.choiceLabel}` })}
                      className="min-h-11 rounded-lg px-3 font-semibold text-danger hover:bg-danger/10"
                    >
                      Remove<span className="sr-only"> option {choice.choiceLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => addMenuOptionAction({ itemId: item.id, label: option }), () => setOption(""));
              }}
            >
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-new-option`} className={LABEL}>
                  New option
                </label>
                <input
                  id={`${idPrefix}-new-option`}
                  maxLength={40}
                  autoComplete="off"
                  placeholder="For example: Shrimp"
                  value={option}
                  onChange={(event) => setOption(event.target.value)}
                  className={FIELD}
                />
              </div>
              <button type="submit" disabled={busy || option.trim() === ""} className={buttonClasses("primary")}>
                Add option
              </button>
            </form>
            {item.choices.length === 1 ? (
              <p className="text-sm font-semibold text-ink">With one option, waiters still choose it. Add another, or remove it.</p>
            ) : null}
          </section>

          <div className="border-t border-glaze pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming({ id: item.id, name: item.name })}
              className="min-h-12 rounded-lg border border-danger px-4 font-semibold text-danger hover:bg-danger/10"
            >
              Remove {item.name} from the menu
            </button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div role="alertdialog" aria-labelledby={`${idPrefix}-confirm`} className="flex flex-col gap-3 rounded-lg border-2 border-danger bg-danger/5 p-3">
          <p id={`${idPrefix}-confirm`} className="font-semibold text-ink">
            Remove {confirming.name} from the menu? Waiters won&apos;t see it any more. Tickets already made keep it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => removeMenuItemAction(confirming.id), () => setConfirming(null))}
              className="min-h-12 rounded-lg bg-danger px-4 font-semibold text-white"
            >
              Yes, remove
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={buttonClasses("secondary")}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
