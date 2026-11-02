import { z } from "zod";

const employeeNumber = z.string().regex(/^[0-9]{1,6}$/);
const id = z.number().int().positive();

export const printKitchenSchema = z.object({
  employeeNumber,
  ticketId: id,
  /** Null: every order that hasn't printed yet. */
  batchIds: z.array(id).min(1).max(100).nullable(),
  clientKey: z.uuid(),
});
export const printCustomerSchema = z.object({ employeeNumber, ticketId: id, version: id.nullable(), clientKey: z.uuid() });
export const printOutcomeSchema = z.object({ employeeNumber, attemptIds: z.array(id).min(1).max(100), printed: z.boolean() });

export type PrintKitchenInput = z.infer<typeof printKitchenSchema>;
export type PrintCustomerInput = z.infer<typeof printCustomerSchema>;
export type PrintOutcomeInput = z.infer<typeof printOutcomeSchema>;

const cents = z.number().int().nonnegative();
const bp = z.number().int().min(0).max(10_000);

/** The bill the database keeps for a print attempt (customer_receipt_snapshot). */
export const customerSnapshotSchema = z.object({
  ticket_number: id,
  waiter_number: z.string(),
  tables: z.string(),
  printed_at: z.string(),
  lines: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int().positive(),
      unit_cents: cents,
      total_cents: cents,
      tax_group: z.enum(["food", "liquor"]),
    }),
  ),
  totals: z.object({
    food_subtotal_cents: cents,
    liquor_subtotal_cents: cents,
    food_rate_bp: bp,
    liquor_rate_bp: bp,
    food_tax_cents: cents,
    liquor_tax_cents: cents,
    total_cents: cents,
  }),
});

export type CustomerSnapshot = z.infer<typeof customerSnapshotSchema>;

/** request_customer_receipt returns one row. */
export const customerAttemptRowsSchema = z
  .array(z.object({ attempt_id: id, receipt: customerSnapshotSchema, is_copy: z.boolean() }))
  .length(1);

/** request_kitchen_print returns one row per order. */
export const kitchenAttemptRowsSchema = z
  .array(z.object({ attempt_id: id, batch_id: id, attempt_no: z.number().int().positive(), is_reprint: z.boolean() }))
  .min(1);

/** One order as the kitchen receipt reads it. No price is ever selected. */
export const kitchenBatchRowSchema = z.object({
  id,
  batch_no: z.number().int().positive(),
  notes: z.string().nullable(),
  waiter: z.object({ employee_number: z.string() }),
  ticket: z.object({
    ticket_number: id,
    own_table: z.object({ label: z.string() }),
    /** Only on tickets made before orders moved to tables; its joined tables are named on the receipt. */
    visit: z.object({ visit_tables: z.array(z.object({ restaurant_tables: z.object({ label: z.string() }) })) }).nullable(),
  }),
  ticket_lines: z.array(z.object({ line_no: z.number().int().positive(), item_name: z.string(), quantity: z.number().int().positive() })),
});

export type KitchenBatchRow = z.infer<typeof kitchenBatchRowSchema>;
