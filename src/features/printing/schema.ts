import { z } from "zod";

const employeeNumber = z.string().regex(/^[0-9]{1,6}$/);
const id = z.number().int().positive();

export const printTicketSchema = z.object({ employeeNumber, visitId: id, ticketId: id, version: id });
export const reprintTicketSchema = z.object({ employeeNumber, ticketId: id });
export const printOutcomeSchema = z.object({ employeeNumber, attemptId: id, printed: z.boolean() });

export type PrintTicketInput = z.infer<typeof printTicketSchema>;
export type ReprintTicketInput = z.infer<typeof reprintTicketSchema>;
export type PrintOutcomeInput = z.infer<typeof printOutcomeSchema>;

const cents = z.number().int().nonnegative();
const bp = z.number().int().min(0).max(10_000);

/** A printed ticket as the database returns it for the receipt. */
export const receiptRowSchema = z.object({
  ticket_number: z.number().int().positive(),
  status: z.literal("printed"),
  printed_at: z.string(),
  food_subtotal_cents: cents,
  liquor_subtotal_cents: cents,
  food_rate_bp: bp,
  liquor_rate_bp: bp,
  food_tax_cents: cents,
  liquor_tax_cents: cents,
  total_cents: cents,
  maker: z.object({ employee_number: z.string() }),
  ticket_lines: z.array(
    z.object({ line_no: z.number().int().positive(), item_name: z.string(), quantity: z.number().int().positive(), unit_price_cents: cents }),
  ),
  visit: z.object({
    visit_tables: z.array(z.object({ restaurant_tables: z.object({ label: z.string(), sort_order: z.number().int() }) })),
  }),
});

export type ReceiptRow = z.infer<typeof receiptRowSchema>;
