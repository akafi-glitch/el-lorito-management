import type { Metadata } from "next";

import { SectionShell } from "@/components/section-shell";
import { FloorMap } from "@/features/floor/components/floor-map";
import { loadFloorMap } from "@/features/floor/queries";

export const metadata: Metadata = { title: "Floor Management" };

export default async function FloorPage() {
  const map = await loadFloorMap();

  return (
    <SectionShell
      title="Floor Management"
      description="Every table and its status. Seating, chips, and clearing arrive in the next phase."
      wide
    >
      <FloorMap map={map} />
    </SectionShell>
  );
}
