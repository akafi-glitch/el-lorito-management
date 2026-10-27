import type { Metadata } from "next";

import { ComingSoon, SectionShell } from "@/components/section-shell";

export const metadata: Metadata = { title: "Management" };

export default function ManagePage() {
  return (
    <SectionShell title="Management" description="Sections, staff, shifts, and administrator accounts.">
      <ComingSoon
        phase={4}
        items={[
          "Employees, shifts, and section assignments",
          "Adding and turning off administrator accounts",
          "Opening and closing sections arrives with seating in Phase 3",
        ]}
      />
    </SectionShell>
  );
}
