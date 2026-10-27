import type { Metadata } from "next";

import { ComingSoon, SectionShell } from "@/components/section-shell";

export const metadata: Metadata = { title: "Waiter Section" };

export default function WaiterPage() {
  return (
    <SectionShell title="Waiter Section" description="Enter your employee number, choose a table, and print a ticket.">
      <ComingSoon
        phase={5}
        items={[
          "Employee number entry and your assigned tables",
          "Menu, tickets, and printing follow in Phases 6 to 9",
        ]}
      />
    </SectionShell>
  );
}
