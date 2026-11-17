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
  parent_item_id: z.number().int().positive().nullable(),
  is_retired: z.boolean(),
  choice_label: z.string().nullable(),
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

const priceField = z.string().transform((value, ctx) => {
  const cents = parseDollars(value);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter a price like 8.25 (up to $10,000)." });
    return z.NEVER;
  }
  return cents;
});
const nameField = z.string().trim().min(1, "Enter the item's name.").max(80, "Keep the name to 80 characters.");
const descriptionField = z.string().trim().max(400, "Keep the description to 400 characters.");

/** Management: a new item on a menu page. */
export const addMenuItemSchema = z.object({
  categoryId: z.number().int().positive(),
  name: nameField,
  description: descriptionField,
  price: priceField,
  taxCategory: z.enum(TAX_CATEGORIES, { message: "Choose the tax type." }),
});
export type AddMenuItemInput = z.input<typeof addMenuItemSchema>;

/** Management: everything about an item that a manager changes. Its options follow it. */
export const editMenuItemSchema = z.object({
  id: z.number().int().positive(),
  name: nameField,
  description: descriptionField,
  price: priceField,
  taxCategory: z.enum(TAX_CATEGORIES, { message: "Choose the tax type." }),
  isAvailable: z.boolean(),
});
export type EditMenuItemInput = z.input<typeof editMenuItemSchema>;

/** Management: an option waiters choose from when they tap the item, such as "Shrimp". */
export const addMenuOptionSchema = z.object({
  itemId: z.number().int().positive(),
  label: z
    .string()
    .trim()
    .min(1, "Enter the option, such as Shrimp.")
    .max(40, "Keep the option to 40 characters.")
    .refine((value) => !/[()]/.test(value), "Leave out brackets: they are added for you."),
});
export type AddMenuOptionInput = z.input<typeof addMenuOptionSchema>;

/** What a waiter chooses for a custom item. Beer and cocktails are taxed as liquor. */
export const TAX_CATEGORY_LABEL: Record<(typeof TAX_CATEGORIES)[number], string> = {
  food: "Food",
  nonalcoholic: "Nonalcoholic drink",
  beer: "Beer (liquor tax)",
  cocktail: "Cocktail or wine (liquor tax)",
};
