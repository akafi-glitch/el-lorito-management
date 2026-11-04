import "server-only";

import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import { kitchenReceiptFromRow, type KitchenReceiptData } from "./receipt";
import { kitchenBatchRowSchema } from "./schema";

const KITCHEN_SELECT = `id, batch_no, notes,
  waiter:employees!ticket_batches_employee_id_fkey(employee_number),
  ticket:tickets!inner(ticket_number, own_table:restaurant_tables(label), visit:customer_visits(visit_tables(restaurant_tables(label)))),
  ticket_lines(line_no, item_name, quantity, notes, menu_item:menu_items(name_es))`;

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

/** The kitchen receipts for these print attempts, in the order given, from what is saved now. */
export async function loadKitchenReceipts(attempts: readonly { batchId: number; isReprint: boolean }[]): Promise<KitchenReceiptData[]> {
  const { data, error } = await createAdminClient()
    .from("ticket_batches")
    .select(KITCHEN_SELECT)
    .in("id", attempts.map((attempt) => attempt.batchId));
  if (error) throw new Error(`Could not load the kitchen receipt: ${error.message}`);
  const rows = z.array(kitchenBatchRowSchema).parse(data);
  const time = formatReceiptTime(new Date().toISOString());
  return attempts.flatMap((attempt) => {
    const row = rows.find((candidate) => candidate.id === attempt.batchId);
    return row ? [kitchenReceiptFromRow(row, attempt.isReprint, time)] : [];
  });
}
