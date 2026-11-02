"use client";

import { useState, type FormEvent } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

import { parseCustomItem } from "../custom-item";
import type { CustomItem } from "../order-draft";
import { TAX_CATEGORY_LABEL, TAX_CATEGORIES } from "../schema";

const fieldClass =
  "min-h-12 w-full rounded-lg border border-glaze bg-paper px-3 text-base text-ink focus:border-leaf focus:outline-none";

/** Name, price, quantity, and tax for an item that isn't on the menu. The tax is always chosen, never guessed. */
export function CustomItemDialog({ onAdd, onClose }: { onAdd: (item: CustomItem, quantity: number) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [tax, setTax] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = parseCustomItem({ name, price, quantity, taxCategory: tax });
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    onAdd(result.item, result.quantity);
    onClose();
  }

  return (
    <Modal title="Add Custom Item" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="custom-name" className="text-sm font-semibold text-ink">
            Food or item name
          </label>
          <input id="custom-name" value={name} maxLength={80} autoComplete="off" onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="custom-price" className="text-sm font-semibold text-ink">
              Price
            </label>
            <input id="custom-price" value={price} inputMode="decimal" autoComplete="off" placeholder="0.00" onChange={(event) => setPrice(event.target.value)} className={fieldClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="custom-quantity" className="text-sm font-semibold text-ink">
              Quantity
            </label>
            <input id="custom-quantity" value={quantity} inputMode="numeric" autoComplete="off" onChange={(event) => setQuantity(event.target.value)} className={fieldClass} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="custom-tax" className="text-sm font-semibold text-ink">
            Tax type
          </label>
          <select id="custom-tax" value={tax} onChange={(event) => setTax(event.target.value)} className={fieldClass}>
            <option value="">Choose…</option>
            {TAX_CATEGORIES.map((code) => (
              <option key={code} value={code}>
                {TAX_CATEGORY_LABEL[code]}
              </option>
            ))}
          </select>
        </div>
        {problem ? (
          <p role="alert" className="rounded-lg border-2 border-danger bg-danger/10 px-3 py-2 text-base font-semibold text-danger">
            {problem}
          </p>
        ) : null}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("secondary")} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={buttonClasses("primary")}>
            Add to order
          </button>
        </div>
      </form>
    </Modal>
  );
}
