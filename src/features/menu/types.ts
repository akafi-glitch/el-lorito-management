import type { LatePricing } from "./pricing";

export type TaxCategory = "food" | "nonalcoholic" | "beer" | "cocktail";

export type MenuItem = {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  priceCents: number;
  taxCategory: TaxCategory;
  isAvailable: boolean;
  /** Beef or Chicken: what the waiter picks from when they tap this item. Each is its own item, ordered instead. */
  choices: MenuItem[];
  /** For a choice, what it is called in the question: "Beef". */
  choiceLabel: string | null;
};

export type MenuCategory = {
  id: number;
  code: string;
  name: string;
  note: string | null;
  late: LatePricing | null;
  items: MenuItem[];
};

export type Menu = { categories: MenuCategory[] };
