import { parseTimeOfDay } from "./pricing";
import type { MenuCategoryRow, MenuItemRow } from "./schema";
import type { Menu, MenuItem } from "./types";

/** "Monterrey (Beef)" -> "Beef": a choice's name ends with what was chosen. */
export function choiceLabel(name: string): string {
  return /\(([^()]+)\)\s*$/.exec(name)?.[1]?.trim() ?? name;
}

function toItem(item: MenuItemRow, choices: MenuItem[]): MenuItem {
  return {
    id: item.id,
    categoryId: item.category_id,
    name: item.name,
    description: item.description,
    priceCents: item.price_cents,
    taxCategory: item.tax_category_code,
    isAvailable: item.is_available,
    choices,
    choiceLabel: item.parent_item_id === null ? null : (item.choice_label ?? choiceLabel(item.name)),
  };
}

/**
 * Database rows -> the menu in display order. Turned-off categories and retired items are left out; an item's
 * choices (Beef, Chicken) are listed under it, not on their own.
 */
export function buildMenu(categoryRows: readonly MenuCategoryRow[], itemRows: readonly MenuItemRow[]): Menu {
  const items = [...itemRows].filter((item) => !item.is_retired).sort((a, b) => a.sort_order - b.sort_order);
  const choicesOf = (id: number) => items.filter((item) => item.parent_item_id === id).map((item) => toItem(item, []));
  return {
    categories: [...categoryRows]
      .filter((row) => row.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        note: row.note,
        late:
          row.late_from !== null && row.late_surcharge_cents !== null
            ? { fromMinutes: parseTimeOfDay(row.late_from), surchargeCents: row.late_surcharge_cents }
            : null,
        items: items
          .filter((item) => item.category_id === row.id && item.parent_item_id === null)
          .map((item) => toItem(item, choicesOf(item.id))),
      })),
  };
}
