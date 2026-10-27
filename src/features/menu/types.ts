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
