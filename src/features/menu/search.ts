import type { MenuCategory, MenuItem } from "./types";

/** Lowercase, no accents, no punctuation: "Jalapeños, #5" -> "jalapenos 5". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string): string[] {
  const text = normalizeText(value);
  return text === "" ? [] : text.split(" ");
}

export type SearchHit = { item: MenuItem; category: MenuCategory };

/**
 * Every typed word must start a word of the item's name, description, or category.
 * "combo 5" finds Combo #5 (not #15); "chick ench" finds chicken enchiladas.
 * Name matches come first, then menu order.
 */
export function searchMenu(categories: readonly MenuCategory[], query: string): SearchHit[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const scored: { hit: SearchHit; rank: number; order: number }[] = [];
  let order = 0;
  for (const category of categories) {
    const categoryWords = words(category.name);
    for (const item of category.items) {
      order += 1;
      const nameWords = words(item.name);
      const allWords = [...nameWords, ...words(item.description ?? ""), ...categoryWords];
      const matches = (pool: string[]) => terms.every((term) => pool.some((word) => word.startsWith(term)));
      if (!matches(allWords)) continue;
      scored.push({ hit: { item, category }, rank: matches(nameWords) ? 0 : 1, order });
    }
  }
  return scored.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.hit);
}
