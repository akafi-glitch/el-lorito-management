"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/features/auth/session";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";

import { menuErrorMessage } from "./errors";
import { formatCents } from "./money";
import { updateMenuItemSchema, type UpdateMenuItemInput } from "./schema";

/** Management: new price and/or on/off. Old tickets keep their own copied prices. */
export async function updateMenuItemAction(input: UpdateMenuItemInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = updateMenuItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the price." };

  const { id, price, isAvailable } = parsed.data;
  const { data, error } = await createAdminClient().rpc("update_menu_item", {
    p_item_id: id,
    p_price_cents: price,
    p_is_available: isAvailable,
    p_actor: user.userId,
  });
  if (error) {
    revalidatePath("/manage/menu");
    return { ok: false, message: menuErrorMessage(error) };
  }
  revalidatePath("/manage/menu");
  revalidatePath("/waiter", "layout");
  const name = typeof data === "string" ? data : "Item";
  return { ok: true, message: `${name}: ${formatCents(price)}, ${isAvailable ? "available" : "turned off"}.` };
}
