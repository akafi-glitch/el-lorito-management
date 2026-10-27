import { parseTimeOfDay } from "./pricing";
import type { MenuCategoryRow, MenuItemRow } from "./schema";
import type { Menu } from "./types";

/** Database rows -> the menu in display order. Turned-off categories are left out. */
export function buildMenu(categoryRows: readonly MenuCategoryRow[], itemRows: readonly MenuItemRow[]): Menu {
  const items = [...itemRows].sort((a, b) => a.sort_order - b.sort_order);
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
          .filter((item) => item.category_id === row.id)
          .map((item) => ({
            id: item.id,
            categoryId: item.category_id,
            name: item.name,
            description: item.description,
            priceCents: item.price_cents,
            taxCategory: item.tax_category_code,
            isAvailable: item.is_available,
          })),
      })),
  };
}
