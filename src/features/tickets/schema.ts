import { z } from "zod";

import { MAX_PRICE_CENTS } from "@/features/menu/money";
import { ITEM_NOTE_MAX, MAX_QUANTITY } from "@/features/menu/order-draft";
import { TAX_CATEGORIES } from "@/features/menu/schema";
import { tableCodeSchema } from "@/features/waiter/schema";

const staffRow = z.object({ full_name: z.string(), employee_number: z.string() });
const cents = z.number().int().nonnegative();

export const ticketRowSchema = z.object({
  id: z.number().int().positive(),
  ticket_number: z.number().int().positive(),
  status: z.enum(["open", "printed", "cancelled", "finalized"]),
  version: z.number().int().positive(),
  legacy_single_order: z.boolean(),
  created_at: z.string(),
  finalized_at: z.string().nullable(),
  maker: staffRow,
  editor: staffRow.nullable(),
  ticket_batches: z.array(
    z.object({
      id: z.number().int().positive(),
      batch_no: z.number().int().positive(),
      notes: z.string().nullable(),
      created_at: z.string(),
      kitchen_printed_at: z.string().nullable(),
      waiter: z.object({ employee_number: z.string() }),
      print_attempts: z.array(z.object({ attempt_no: z.number().int().positive(), outcome: z.enum(["unknown", "printed", "not_printed"]) })),
      ticket_lines: z.array(
        z.object({
          id: z.number().int().positive(),
          line_no: z.number().int().positive(),
          menu_item_id: z.number().int().positive().nullable(),
          is_custom: z.boolean(),
          item_name: z.string(),
          unit_price_cents: cents,
          late_surcharge_cents: cents,
          quantity: z.number().int().positive(),
          tax_group_code: z.enum(["food", "liquor"]),
          notes: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export type TicketRow = z.infer<typeof ticketRowSchema>;

/** One row of the public.ticket_totals view. */
export const ticketTotalsRowSchema = z.object({
  ticket_id: z.number().int().positive(),
  food_subtotal_cents: cents,
  liquor_subtotal_cents: cents,
  food_rate_bp: z.number().int().min(0).max(10_000),
  liquor_rate_bp: z.number().int().min(0).max(10_000),
  food_tax_cents: cents,
  liquor_tax_cents: cents,
  total_cents: cents,
});

export type TicketTotalsRow = z.infer<typeof ticketTotalsRowSchema>;

const quantity = z.number().int().min(1, "Quantities start at 1.").max(MAX_QUANTITY, `Quantities go up to ${MAX_QUANTITY}.`);

const itemNote = z
  .string()
  .max(ITEM_NOTE_MAX, `Use ${ITEM_NOTE_MAX} characters or fewer for an item's note.`)
  .transform((value) => value.trim() || null)
  .nullable();

const orderLine = z.union([
  z.object({ itemId: z.number().int().positive(), quantity, notes: itemNote.optional() }),
  z.object({
    name: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1, "Enter the custom item's name.").max(80, "Use 80 characters or fewer for a name.")),
    priceCents: z.number().int().min(0, "A price can't be negative.").max(MAX_PRICE_CENTS, "That price is too high."),
    taxCategory: z.enum(TAX_CATEGORIES, { message: "Choose the custom item's tax type." }),
    quantity,
    notes: itemNote.optional(),
  }),
]);

const employeeNumber = z.string().regex(/^[0-9]{1,6}$/);

export const NOTE_MAX = 500;
const notes = z
  .string()
  .max(NOTE_MAX, `Use ${NOTE_MAX} characters or fewer for a note.`)
  .transform((value) => value.trim() || null)
  .nullable();

export const saveOrderSchema = z.object({
  employeeNumber,
  tableCode: tableCodeSchema,
  clientKey: z.uuid(),
  lines: z
    .array(orderLine)
    .min(1, "Add at least one item before saving.")
    .max(100, "An order can have up to 100 different items.")
    .refine((list) => {
      const ids = list.flatMap((line) => ("itemId" in line ? [line.itemId] : []));
      return new Set(ids).size === ids.length;
    }, "Each menu item can appear once."),
  notes,
});

export type SaveOrderInput = z.input<typeof saveOrderSchema>;

/** A new to-go order: the database chooses its spot. */
export const saveToGoOrderSchema = saveOrderSchema.omit({ tableCode: true });
export type SaveToGoOrderInput = z.input<typeof saveToGoOrderSchema>;

export const changeTicketSchema = z.object({
  employeeNumber,
  ticketId: z.number().int().positive(),
  version: z.number().int().positive(),
  changes: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("quantity"), lineId: z.number().int().positive(), quantity }),
        z.object({ op: z.literal("remove"), lineId: z.number().int().positive() }),
        z.object({ op: z.literal("notes"), batchId: z.number().int().positive(), notes }),
        z.object({ op: z.literal("line_notes"), lineId: z.number().int().positive(), notes: itemNote }),
      ]),
    )
    .min(1)
    .max(100),
});

export type ChangeTicketInput = z.input<typeof changeTicketSchema>;

/** A manager's number and PIN, for one approval. Whether they are right is decided only on the server. */
export const managerApprovalSchema = z.object({ managerNumber: z.string(), pin: z.string() });
export type ManagerApprovalInput = z.infer<typeof managerApprovalSchema>;

export const cancelTicketSchema = z.object({
  employeeNumber,
  ticketId: z.number().int().positive(),
  version: z.number().int().positive(),
});

export type CancelTicketInput = z.infer<typeof cancelTicketSchema>;

/** "?ticket=1001" in the table page link. */
export const ticketNumberParamSchema = z.coerce.number().int().min(1001).max(Number.MAX_SAFE_INTEGER);
