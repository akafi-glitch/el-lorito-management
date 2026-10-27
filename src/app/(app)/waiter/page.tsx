import type { Metadata } from "next";

import { SectionShell } from "@/components/section-shell";
import { NumberPad } from "@/features/waiter/components/number-pad";

export const metadata: Metadata = { title: "Waiter Section" };

export default function WaiterPage() {
  return (
    <SectionShell title="Waiter Section" description="Enter your employee number to see your tables.">
      <NumberPad />
    </SectionShell>
  );
}
