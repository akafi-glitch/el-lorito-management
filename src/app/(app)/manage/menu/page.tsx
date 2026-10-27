import type { Metadata } from "next";

import { LiveSync } from "@/features/sync/components/live-sync";
import { loadVersions } from "@/features/sync/queries";
import { MenuManager } from "@/features/menu/components/menu-manager";
import { loadMenu } from "@/features/menu/queries";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage() {
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const menu = await loadMenu();
  return (
    <>
      <LiveSync watch={["menu"]} versions={versions} />
      <MenuManager menu={menu} />
    </>
  );
}
