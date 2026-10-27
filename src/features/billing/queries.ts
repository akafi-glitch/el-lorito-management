import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildTaxSetup, taxCategoryRowSchema, taxGroupRowSchema, type TaxSetup } from "./setup";

/** The tax rates and category-to-group mapping (two tiny reads). */
export async function loadTaxSetup(): Promise<TaxSetup> {
  const db = createAdminClient();
  const [groups, categories] = await Promise.all([
    db.from("tax_groups").select("code, rate_bp"),
    db.from("tax_categories").select("code, tax_group_code"),
  ]);
  if (groups.error) throw new Error(`Could not load the tax rates: ${groups.error.message}`);
  if (categories.error) throw new Error(`Could not load the tax categories: ${categories.error.message}`);
  return buildTaxSetup(z.array(taxGroupRowSchema).parse(groups.data), z.array(taxCategoryRowSchema).parse(categories.data));
}
