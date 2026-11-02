import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildFloorMap, type FloorMap, type SectionStaff } from "./layout";
import {
  assignmentLabelRowSchema,
  combinationRowSchema,
  floorAreaRowSchema,
  openVisitTableRowSchema,
  rotationPositionRowSchema,
  rotationRowSchema,
  sectionRowSchema,
  tableRowSchema,
} from "./schema";
import { visitsByTable } from "./visits";

/**
 * The parts of the floor that hardly ever change (drawn blocks, tables, combinations). Cached briefly
 * so every floor reload doesn't read them again; a capacity changed in the database shows within a minute.
 */
const loadFloorLayout = unstable_cache(
  async () => {
    const db = createAdminClient();
    const [areas, tables, combinations] = await Promise.all([
      db.from("floor_areas").select("code, name, floor_row, floor_col, row_span, col_span, sort_order"),
      db
        .from("restaurant_tables")
        .select("id, code, label, section_code, capacity, area_code, layout_row, layout_col, sort_order, is_active"),
      db
        .from("table_combinations")
        .select("id, code, label, allows_over_twelve, is_active, sort_order, table_combination_members(table_id)"),
    ]);
    for (const [name, result] of Object.entries({ areas, tables, combinations })) {
      if (result.error) throw new Error(`Could not load the floor (${name}): ${result.error.message}`);
    }
    return {
      areas: z.array(floorAreaRowSchema).parse(areas.data),
      tables: z.array(tableRowSchema).parse(tables.data),
      combinations: z.array(combinationRowSchema).parse(combinations.data),
    };
  },
  ["floor-layout-v2"],
  { revalidate: 60 },
);

/**
 * Loads the floor for the signed-in floor screen: layout, who is seated where, and the rotation.
 * Server only. The live parts are five small reads, run in parallel.
 */
export async function loadFloorMap(): Promise<FloorMap> {
  const db = createAdminClient();

  const [layout, sections, openTables, nextSection, rotation, assignments] = await Promise.all([
    loadFloorLayout(),
    db.from("sections").select("code, name, kind, rotation_order, is_open, open_to_all_waiters, sort_order"),
    db
      .from("visit_tables")
      .select("table_id, visit_id, customer_visits!inner(id, version, guest_count, chips_status, cleared_at)")
      .is("released_at", null),
    db.from("rotation_state").select("next_section_code").maybeSingle(),
    db.rpc("current_rotation"),
    db.from("current_assignments").select("section_code, duty, full_name, employee_number"),
  ]);

  for (const [name, result] of Object.entries({ sections, openTables, nextSection, rotation, assignments })) {
    if (result.error) throw new Error(`Could not load the floor (${name}): ${result.error.message}`);
  }

  return buildFloorMap(
    { areas: layout.areas, sections: z.array(sectionRowSchema).parse(sections.data), tables: layout.tables, combinations: layout.combinations },
    {
      visits: visitsByTable(z.array(openVisitTableRowSchema).parse(openTables.data), layout.tables),
      nextSectionCode: nextSection.data ? rotationRowSchema.parse(nextSection.data).next_section_code : null,
      rotation: z
        .array(rotationPositionRowSchema)
        .parse(rotation.data)
        .sort((a, b) => a.section_position - b.section_position)
        .map((row) => row.section_code),
      staff: staffBySection(z.array(assignmentLabelRowSchema).parse(assignments.data)),
    },
  );
}

function staffBySection(rows: z.infer<typeof assignmentLabelRowSchema>[]): Record<string, SectionStaff> {
  const staff: Record<string, SectionStaff> = {};
  for (const row of rows) {
    const entry = (staff[row.section_code] ??= { waiter: null, runner: null });
    const label = `${row.full_name} (${row.employee_number})`;
    if (row.duty === "waiter") entry.waiter = label;
    else entry.runner = label;
  }
  return staff;
}
