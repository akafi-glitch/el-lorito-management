import type { Metadata } from "next";

import { MenuManager } from "@/features/menu/components/menu-manager";
import { loadMenu } from "@/features/menu/queries";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage() {
  const menu = await loadMenu();
  return <MenuManager menu={menu} />;
}
