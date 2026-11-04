import type { Metadata } from "next";
import Link from "next/link";

import { SectionShell } from "@/components/section-shell";
import { buttonClasses } from "@/components/ui/button";
import { loadVersions } from "@/features/sync/queries";
import { TableOrderScreen } from "@/features/tickets/components/table-order-screen";
import { KITCHEN_MARK_TEXT } from "@/features/tickets/rules";
import { WaiterRefused } from "@/features/waiter/components/waiter-refused";
import { loadOpenToGoOrders } from "@/features/waiter/queries";
import { resolveWaiter } from "@/features/waiter/resolve";
import { tablePath, waiterPath } from "@/features/waiter/rules";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "To-Go Order" };

type Props = { params: Promise<{ number: string }> };

/** A new to-go order, straight to the menu. Saving it gives it a spot; open ones are listed to get back to. */
export default async function ToGoOrderPage({ params }: Props) {
  const result = await resolveWaiter((await params).number);
  if (!result.ok) {
    return (
      <SectionShell title="To-Go Order" description="Waiter Section">
        <WaiterRefused message={result.message} />
      </SectionShell>
    );
  }

  const me = result.employee;
  const back = waiterPath(me);
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const open = await loadOpenToGoOrders();

  return (
    <SectionShell title="To-Go Order" description="Waiter Section" live={{ watch: ["tickets", "menu", "staff"], versions }}>
      <div className="flex flex-col gap-6">
        {open.length > 0 ? (
          <nav aria-labelledby="open-to-go-heading" className="rounded-2xl border border-glaze bg-paper p-4">
            <h2 id="open-to-go-heading" className="text-lg font-bold text-ink">
              Open to-go orders
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {open.map((order) => (
                <li key={order.code}>
                  <Link
                    href={tablePath(back, order.code)}
                    className={`flex min-h-14 flex-col justify-center rounded-xl border-2 px-4 py-1 font-bold ${
                      order.kitchen === "printed"
                        ? "border-status-kitchen bg-status-kitchen text-white"
                        : order.kitchen === "saved"
                          ? "border-status-saved bg-status-saved text-white"
                          : "border-glaze bg-paper text-ink hover:border-leaf"
                    }`}
                  >
                    <span>
                      {order.label} · #{order.ticketNumber}
                    </span>
                    {order.kitchen ? <span className="text-xs font-semibold">{KITCHEN_MARK_TEXT[order.kitchen]}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <TableOrderScreen
          employeeNumber={me.number}
          tableCode={null}
          toGoBasePath={back}
          ticket={null}
          menuVersion={versions.menu}
          timeZone={serverEnv().APP_TIME_ZONE}
          nowIso={new Date().toISOString()}
          paperWidthMm={serverEnv().RECEIPT_PAPER_WIDTH_MM}
        />

        <Link href={back} className={buttonClasses("secondary", "self-start")}>
          Choose another table
        </Link>
      </div>
    </SectionShell>
  );
}
