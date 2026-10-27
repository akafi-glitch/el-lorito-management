import { z } from "zod";

import { TAX_CATEGORIES } from "@/features/menu/schema";
import type { TaxCategory } from "@/features/menu/types";

import { TAX_GROUPS, type TaxGroup, type TaxRates } from "./tax";

/** Rates and which tax group each tax category belongs to, as stored in the database. */
export type TaxSetup = { rates: TaxRates; groupOf: Readonly<Record<TaxCategory, TaxGroup>> };

export const taxGroupRowSchema = z.object({ code: z.enum(TAX_GROUPS), rate_bp: z.number().int().min(0).max(10_000) });
export const taxCategoryRowSchema = z.object({ code: z.enum(TAX_CATEGORIES), tax_group_code: z.enum(TAX_GROUPS) });

/** Database rows -> rates and mapping. A missing group or category is an error, never a guess. */
export function buildTaxSetup(
  groups: readonly z.infer<typeof taxGroupRowSchema>[],
  categories: readonly z.infer<typeof taxCategoryRowSchema>[],
): TaxSetup {
  const rate = (code: TaxGroup) => {
    const found = groups.find((group) => group.code === code);
    if (!found) throw new Error(`Tax group ${code} is missing`);
    return found.rate_bp;
  };
  const groupOf = Object.fromEntries(
    TAX_CATEGORIES.map((code) => {
      const found = categories.find((category) => category.code === code);
      if (!found) throw new Error(`Tax category ${code} is missing`);
      return [code, found.tax_group_code];
    }),
  ) as TaxSetup["groupOf"];
  return { rates: { food: rate("food"), liquor: rate("liquor") }, groupOf };
}
