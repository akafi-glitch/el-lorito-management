import type { Metadata } from "next";

import { ComingSoon, SectionShell } from "@/components/section-shell";

export const metadata: Metadata = { title: "Floor Management" };

export default function FloorPage() {
  return (
    <SectionShell title="Floor Management" description="Seat guests, track chips, and clear tables.">
      <ComingSoon
        phase={2}
        items={[
          "The floor map with every section and table",
          "Green, yellow, and red table status (Phase 3 adds seating and chips)",
        ]}
      />
    </SectionShell>
  );
}
