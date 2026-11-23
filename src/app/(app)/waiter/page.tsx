import type { Metadata } from "next";

import { LiveSync } from "@/features/sync/components/live-sync";
import { loadVersions } from "@/features/sync/queries";
import { loadEmployees } from "@/features/staff/queries";
import { WaiterChooser, WaiterHeader } from "@/features/waiter/components/waiter-chooser";
import { restaurantIsOpen } from "@/features/waiter/queries";
import { RESTAURANT_CLOSED_TEXT } from "@/features/waiter/rules";

export const metadata: Metadata = { title: "Waiter Section" };

/** One screen on a laptop or iPad (owner decision, Nov 22, 2026): a slim top line, and the waiter boxes fill the rest. */
export default async function WaiterPage() {
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const open = await restaurantIsOpen();
  const waiters = open ? (await loadEmployees()).filter((employee) => employee.role === "waiter" && employee.isActive) : [];
  const live = <LiveSync watch={["staff"]} versions={versions} />;

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:overflow-hidden">
      <main className="mx-auto flex min-h-0 w-full max-w-[112rem] flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
        {open ? (
          <WaiterChooser waiters={waiters} live={live} />
        ) : (
          <>
            <WaiterHeader title="Waiter Section" live={live} />
            <p
              data-testid="restaurant-closed"
              className="mx-auto mt-6 max-w-md rounded-xl border-2 border-glaze bg-paper px-4 py-6 text-center text-lg font-semibold text-ink"
            >
              {RESTAURANT_CLOSED_TEXT}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
