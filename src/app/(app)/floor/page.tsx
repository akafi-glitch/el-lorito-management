import type { Metadata } from "next";

import { SectionShell } from "@/components/section-shell";
import { FloorScreen } from "@/features/floor/components/floor-screen";
import { loadFloorMap } from "@/features/floor/queries";
import { loadVersions } from "@/features/sync/queries";

export const metadata: Metadata = { title: "Floor Management" };

export default async function FloorPage() {
  // Versions first, then data: a change in between causes one extra refresh, never a missed one.
  const versions = await loadVersions();
  const map = await loadFloorMap();

  return (
    <SectionShell
      title="Floor Management"
      description="Seat guests, mark chips served, and clear tables."
      wide
      live={{ watch: ["floor", "staff"], versions }}
    >
      <FloorScreen map={map} />
    </SectionShell>
  );
}
