import { z } from "zod";

import { parseDollars } from "./money";

export const TAX_CATEGORIES = ["food", "nonalcoholic", "beer", "cocktail"] as const;

/** Rows as the database sends them (checked, not trusted). */
export const menuCategoryRowSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  note: z.string().nullable(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
  late_from: z.string().nullable(),
  late_surcharge_cents: z.number().int().positive().nullable(),
});

export const menuItemRowSchema = z.object({
  id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  price_cents: z.number().int().nonnegative(),
  tax_category_code: z.enum(TAX_CATEGORIES),
  is_available: z.boolean(),
  sort_order: z.number().int(),
});

export type MenuCategoryRow = z.infer<typeof menuCategoryRowSchema>;
export type MenuItemRow = z.infer<typeof menuItemRowSchema>;

/** Management: change an item's price (typed in dollars) and whether it can be ordered. */
export const updateMenuItemSchema = z.object({
  id: z.number().int().positive(),
  price: z
    .string()
    .transform((value, ctx) => {
      const cents = parseDollars(value);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Enter a price like 8.25 (up to $10,000)." });
        return z.NEVER;
      }
      return cents;
    }),
  isAvailable: z.boolean(),
});

export type UpdateMenuItemInput = z.input<typeof updateMenuItemSchema>;
