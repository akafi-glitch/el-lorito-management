import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildFloorMap, type FloorMap } from "./layout";
import {
  combinationRowSchema,
  floorAreaRowSchema,
  openVisitTableRowSchema,
  rotationRowSchema,
  sectionRowSchema,
  tableRowSchema,
} from "./schema";
import { visitsByTable } from "./visits";

/**
 * Loads the floor for the signed-in floor screen: layout, who is seated where, and the rotation.
 * Server only. Six small reads run in parallel.
 */
export async function loadFloorMap(): Promise<FloorMap> {
  const db = createAdminClient();

  const [areas, sections, tables, combinations, openTables, rotation] = await Promise.all([
    db.from("floor_areas").select("code, name, floor_row, floor_col, row_span, col_span, sort_order"),
    db.from("sections").select("code, name, kind, rotation_order, is_open, open_to_all_waiters, sort_order"),
    db
      .from("restaurant_tables")
      .select("id, code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order, is_active"),
    db
      .from("table_combinations")
      .select("id, code, label, allows_over_twelve, is_active, sort_order, table_combination_members(table_id)"),
    db
      .from("visit_tables")
      .select("table_id, visit_id, customer_visits!inner(id, version, guest_count, chips_status, cleared_at)")
      .is("released_at", null),
    db.from("rotation_state").select("next_section_code").maybeSingle(),
  ]);

  for (const [name, result] of Object.entries({ areas, sections, tables, combinations, openTables, rotation })) {
    if (result.error) throw new Error(`Could not load the floor (${name}): ${result.error.message}`);
  }

  const tableRows = z.array(tableRowSchema).parse(tables.data);
  return buildFloorMap(
    {
      areas: z.array(floorAreaRowSchema).parse(areas.data),
      sections: z.array(sectionRowSchema).parse(sections.data),
      tables: tableRows,
      combinations: z.array(combinationRowSchema).parse(combinations.data),
    },
    {
      visits: visitsByTable(z.array(openVisitTableRowSchema).parse(openTables.data), tableRows),
      nextSectionCode: rotation.data ? rotationRowSchema.parse(rotation.data).next_section_code : null,
    },
  );
}
