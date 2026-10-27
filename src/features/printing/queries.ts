import "server-only";

import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import { receiptFromRow, type ReceiptData } from "./receipt";
import { receiptRowSchema } from "./schema";

const SELECT = `ticket_number, status, printed_at, food_subtotal_cents, liquor_subtotal_cents, food_rate_bp, liquor_rate_bp,
  food_tax_cents, liquor_tax_cents, total_cents,
  maker:employees!tickets_employee_id_fkey(employee_number),
  ticket_lines(line_no, item_name, quantity, unit_price_cents),
  visit:customer_visits(visit_tables(restaurant_tables(label, sort_order)))`;

/** "10/27/2026 4:05 PM" in the restaurant's time zone. */
export function formatReceiptTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: serverEnv().APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", "");
}

/** The receipt of a printed ticket, entirely from the database (frozen totals, copied prices). */
export async function loadReceipt(ticketId: number): Promise<ReceiptData> {
  const { data, error } = await createAdminClient().from("tickets").select(SELECT).eq("id", ticketId).single();
  if (error) throw new Error(`Could not load the receipt: ${error.message}`);
  return receiptFromRow(receiptRowSchema.parse(data), formatReceiptTime);
}
