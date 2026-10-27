import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildFloorMap, type FloorMap } from "./layout";
import { combinationRowSchema, floorAreaRowSchema, sectionRowSchema, tableRowSchema } from "./schema";

/**
 * Loads the floor layout for the signed-in floor screen. Runs on the server only; callers must be
 * inside the signed-in area (the (app) layout checks the account before any page renders).
 * Four small reads run in parallel.
 */
export async function loadFloorMap(): Promise<FloorMap> {
  const db = createAdminClient();

  const [areas, sections, tables, combinations] = await Promise.all([
    db.from("floor_areas").select("code, name, floor_row, floor_col, row_span, col_span, sort_order"),
    db.from("sections").select("code, name, kind, rotation_order, is_open, open_to_all_waiters, sort_order"),
    db
      .from("restaurant_tables")
      .select("id, code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order, is_active"),
    db
      .from("table_combinations")
      .select("id, code, label, allows_over_twelve, is_active, sort_order, table_combination_members(table_id)"),
  ]);

  for (const [name, result] of Object.entries({ areas, sections, tables, combinations })) {
    if (result.error) throw new Error(`Could not load the floor (${name}): ${result.error.message}`);
  }

  return buildFloorMap({
    areas: z.array(floorAreaRowSchema).parse(areas.data),
    sections: z.array(sectionRowSchema).parse(sections.data),
    tables: z.array(tableRowSchema).parse(tables.data),
    combinations: z.array(combinationRowSchema).parse(combinations.data),
  });
}
