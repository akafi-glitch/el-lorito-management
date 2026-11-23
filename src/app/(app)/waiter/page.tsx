import type { Metadata } from "next";

import { SectionShell } from "@/components/section-shell";
import { loadVersions } from "@/features/sync/queries";
import { loadEmployees } from "@/features/staff/queries";
import { WaiterChooser } from "@/features/waiter/components/waiter-chooser";
import { restaurantIsOpen } from "@/features/waiter/queries";
import { RESTAURANT_CLOSED_TEXT } from "@/features/waiter/rules";

export const metadata: Metadata = { title: "Waiter Section" };

export default async function WaiterPage() {
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const open = await restaurantIsOpen();
  const waiters = open ? (await loadEmployees()).filter((employee) => employee.role === "waiter" && employee.isActive) : [];

  return (
    <SectionShell
      title="Waiter Section"
      description={open ? "Tap your name to see your tables." : "Closed until the next shift starts."}
      wide
      live={{ watch: ["staff"], versions }}
    >
      {open ? (
        <WaiterChooser waiters={waiters} />
      ) : (
        <p data-testid="restaurant-closed" className="mx-auto max-w-md rounded-xl border-2 border-glaze bg-paper px-4 py-6 text-center text-lg font-semibold text-ink">
          {RESTAURANT_CLOSED_TEXT}
        </p>
      )}
    </SectionShell>
  );
}
