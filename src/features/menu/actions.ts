"use server";

import { requireActiveUser } from "@/features/auth/session";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";

import { menuErrorMessage } from "./errors";
import { formatCents } from "./money";
import {
  addMenuItemSchema,
  addMenuOptionSchema,
  editMenuItemSchema,
  setMenuOptionExtraSchema,
  updateMenuItemSchema,
  type AddMenuItemInput,
  type AddMenuOptionInput,
  type EditMenuItemInput,
  type SetMenuOptionExtraInput,
  type UpdateMenuItemInput,
} from "./schema";

const firstIssue = (issues: { message: string }[], fallback: string) => issues[0]?.message ?? fallback;

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
    return { ok: false, message: menuErrorMessage(error) };
  }
  const name = typeof data === "string" ? data : "Item";
  return { ok: true, message: `${name}: ${formatCents(price)}, ${isAvailable ? "available" : "turned off"}.` };
}

/** Management: a new item at the end of a menu page. Waiters see it at once. */
export async function addMenuItemAction(input: AddMenuItemInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = addMenuItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues, "Check the new item.") };

  const { categoryId, name, description, price, taxCategory } = parsed.data;
  const { error } = await createAdminClient().rpc("add_menu_item", {
    p_category_id: categoryId,
    p_name: name,
    p_description: description,
    p_price_cents: price,
    p_tax_category: taxCategory,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: menuErrorMessage(error) };
  return { ok: true, message: `${name} added at ${formatCents(price)}.` };
}

/** Management: an item's name, description, price, tax, and on/off. Its options follow; old tickets keep theirs. */
export async function editMenuItemAction(input: EditMenuItemInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = editMenuItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues, "Check the item.") };

  const { id, name, description, price, taxCategory, isAvailable } = parsed.data;
  const { error } = await createAdminClient().rpc("update_menu_item_details", {
    p_item_id: id,
    p_name: name,
    p_description: description,
    p_price_cents: price,
    p_tax_category: taxCategory,
    p_is_available: isAvailable,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: menuErrorMessage(error) };
  return { ok: true, message: `${name} saved: ${formatCents(price)}, ${isAvailable ? "available" : "turned off"}.` };
}

/** Management: an option waiters pick when they tap the item. */
export async function addMenuOptionAction(input: AddMenuOptionInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = addMenuOptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues, "Check the option.") };

  const { itemId, label, extra } = parsed.data;
  const { error } = await createAdminClient().rpc("add_menu_option", {
    p_item_id: itemId,
    p_label: label,
    p_actor: user.userId,
    p_extra_cents: extra,
  });
  if (error) return { ok: false, message: menuErrorMessage(error) };
  const charge = extra > 0 ? ` at ${formatCents(extra)} extra` : "";
  return { ok: true, message: `Option ${label} added${charge}. Waiters now choose when they tap the item.` };
}

/** Management: what an option costs on top of its item (0 for nothing extra). */
export async function setMenuOptionExtraAction(input: SetMenuOptionExtraInput): Promise<ActionResult> {
  const user = await requireActiveUser();
  const parsed = setMenuOptionExtraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues, "Check the extra charge.") };

  const { optionId, extra } = parsed.data;
  const { data, error } = await createAdminClient().rpc("set_menu_option_extra", {
    p_option_id: optionId,
    p_extra_cents: extra,
    p_actor: user.userId,
  });
  if (error) return { ok: false, message: menuErrorMessage(error) };
  const name = typeof data === "string" ? data : "The option";
  return { ok: true, message: extra > 0 ? `${name}: ${formatCents(extra)} extra.` : `${name}: no extra charge.` };
}

/** Management: an item (with its options) or one option off the menu for good. Saved tickets keep it. */
export async function removeMenuItemAction(id: number): Promise<ActionResult> {
  const user = await requireActiveUser();
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, message: "That item no longer exists. The page has been refreshed." };
  const { data, error } = await createAdminClient().rpc("remove_menu_item", { p_item_id: id, p_actor: user.userId });
  if (error) return { ok: false, message: menuErrorMessage(error) };
  return { ok: true, message: `${typeof data === "string" ? data : "The item"} is off the menu. Saved tickets keep it.` };
}
