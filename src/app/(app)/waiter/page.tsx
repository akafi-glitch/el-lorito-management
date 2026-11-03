import type { Metadata } from "next";

import { SectionShell } from "@/components/section-shell";
import { loadVersions } from "@/features/sync/queries";
import { NumberPad } from "@/features/waiter/components/number-pad";
import { restaurantIsOpen } from "@/features/waiter/queries";
import { RESTAURANT_CLOSED_TEXT } from "@/features/waiter/rules";

export const metadata: Metadata = { title: "Waiter Section" };

export default async function WaiterPage() {
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const open = await restaurantIsOpen();

  return (
    <SectionShell
      title="Waiter Section"
      description={open ? "Enter your employee number to see your tables." : "Closed until the next shift starts."}
      live={{ watch: ["staff"], versions }}
    >
      {open ? (
        <NumberPad />
      ) : (
        <p data-testid="restaurant-closed" className="mx-auto max-w-md rounded-xl border-2 border-glaze bg-paper px-4 py-6 text-center text-lg font-semibold text-ink">
          {RESTAURANT_CLOSED_TEXT}
        </p>
      )}
    </SectionShell>
  );
}
