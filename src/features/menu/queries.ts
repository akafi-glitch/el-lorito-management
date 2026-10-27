import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildMenu } from "./build";
import { menuCategoryRowSchema, menuItemRowSchema } from "./schema";
import type { Menu } from "./types";

/** The whole menu (about 210 items) in two parallel reads. */
export async function loadMenu(): Promise<Menu> {
  const db = createAdminClient();
  const [categories, items] = await Promise.all([
    db.from("menu_categories").select("id, code, name, note, sort_order, is_active, late_from, late_surcharge_cents"),
    db.from("menu_items").select("id, category_id, name, description, price_cents, tax_category_code, is_available, sort_order"),
  ]);
  if (categories.error) throw new Error(`Could not load the menu categories: ${categories.error.message}`);
  if (items.error) throw new Error(`Could not load the menu: ${items.error.message}`);
  return buildMenu(z.array(menuCategoryRowSchema).parse(categories.data), z.array(menuItemRowSchema).parse(items.data));
}
