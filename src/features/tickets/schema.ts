import { z } from "zod";

import { MAX_QUANTITY } from "@/features/menu/order-draft";

const staffRow = z.object({ full_name: z.string(), employee_number: z.string() });

export const ticketRowSchema = z.object({
  id: z.number().int().positive(),
  ticket_number: z.number().int().positive(),
  visit_id: z.number().int().positive(),
  status: z.enum(["open", "printed", "cancelled"]),
  version: z.number().int().positive(),
  created_at: z.string(),
  maker: staffRow,
  editor: staffRow.nullable(),
  ticket_lines: z.array(
    z.object({
      line_no: z.number().int().positive(),
      menu_item_id: z.number().int().positive(),
      item_name: z.string(),
      unit_price_cents: z.number().int().nonnegative(),
      late_surcharge_cents: z.number().int().nonnegative(),
      quantity: z.number().int().positive(),
      tax_group_code: z.enum(["food", "liquor"]),
    }),
  ),
});

export type TicketRow = z.infer<typeof ticketRowSchema>;

const lines = z
  .array(z.object({ itemId: z.number().int().positive(), quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
  .min(1, "Add at least one item before saving.")
  .max(100, "A ticket can have up to 100 different items.")
  .refine((list) => new Set(list.map((line) => line.itemId)).size === list.length, "Each item can appear once.");

const employeeNumber = z.string().regex(/^[0-9]{1,6}$/);

export const saveTicketSchema = z
  .object({
    employeeNumber,
    visitId: z.number().int().positive(),
    ticketId: z.number().int().positive().nullable(),
    version: z.number().int().positive().nullable(),
    lines,
  })
  .refine((input) => (input.ticketId === null) === (input.version === null), "Ticket and version go together.");

export type SaveTicketInput = z.infer<typeof saveTicketSchema>;

export const cancelTicketSchema = z.object({
  employeeNumber,
  visitId: z.number().int().positive(),
  ticketId: z.number().int().positive(),
  version: z.number().int().positive(),
});

export type CancelTicketInput = z.infer<typeof cancelTicketSchema>;

/** "?ticket=1001" in the table page link. */
export const ticketNumberParamSchema = z.coerce.number().int().min(1001).max(Number.MAX_SAFE_INTEGER);
