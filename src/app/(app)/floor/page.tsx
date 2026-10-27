import type { Metadata } from "next";

import { SectionShell } from "@/components/section-shell";
import { FloorScreen } from "@/features/floor/components/floor-screen";
import { loadFloorMap } from "@/features/floor/queries";

export const metadata: Metadata = { title: "Floor Management" };

export default async function FloorPage() {
  const map = await loadFloorMap();

  return (
    <SectionShell
      title="Floor Management"
      description="Seat guests, mark chips served, and clear tables."
      wide
    >
      <FloorScreen map={map} />
    </SectionShell>
  );
}
