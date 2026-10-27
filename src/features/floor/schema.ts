import { z } from "zod";

/**
 * Shapes of the floor rows as they come from the database. Parsing them (instead of trusting
 * them) means a schema change shows up as one clear error, not as odd behaviour on screen.
 */

export const floorAreaRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  floor_row: z.number().int().positive(),
  floor_col: z.number().int().positive(),
  row_span: z.number().int().positive(),
  col_span: z.number().int().positive(),
  sort_order: z.number().int(),
});

export const sectionRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(["dining", "party", "bar"]),
  rotation_order: z.number().int().positive().nullable(),
  is_open: z.boolean(),
  open_to_all_waiters: z.boolean(),
  sort_order: z.number().int(),
});

export const tableRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  label: z.string(),
  section_code: z.string(),
  capacity: z.number().int().positive().nullable(),
  area_code: z.string(),
  layout_row: z.number().int().positive(),
  layout_col: z.number().int().positive(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});

export const combinationRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  label: z.string(),
  allows_over_twelve: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  table_combination_members: z.array(z.object({ table_id: z.uuid() })),
});

export const openVisitTableRowSchema = z.object({
  table_id: z.uuid(),
  visit_id: z.number().int().positive(),
  customer_visits: z.object({
    id: z.number().int().positive(),
    version: z.number().int().positive(),
    guest_count: z.number().int().positive(),
    chips_status: z.enum(["needed", "served"]),
    cleared_at: z.string().nullable(),
  }),
});

export const rotationRowSchema = z.object({ next_section_code: z.string() });

export type OpenVisitTableRow = z.infer<typeof openVisitTableRowSchema>;
export type FloorAreaRow = z.infer<typeof floorAreaRowSchema>;
export type SectionRow = z.infer<typeof sectionRowSchema>;
export type TableRow = z.infer<typeof tableRowSchema>;
export type CombinationRow = z.infer<typeof combinationRowSchema>;

export type FloorRows = {
  areas: FloorAreaRow[];
  sections: SectionRow[];
  tables: TableRow[];
  combinations: CombinationRow[];
};
