import type { Metadata } from "next";
import Link from "next/link";

import { SectionShell } from "@/components/section-shell";
import { buttonClasses } from "@/components/ui/button";
import { ROLE_LABEL, employeeLabel } from "@/features/staff/rules";
import { WaiterRefused } from "@/features/waiter/components/waiter-refused";
import { WaiterTables } from "@/features/waiter/components/waiter-tables";
import { loadWaiterScreen } from "@/features/waiter/queries";
import { resolveWaiter } from "@/features/waiter/resolve";
import { waiterPath } from "@/features/waiter/rules";

export const metadata: Metadata = { title: "Your tables" };

type Props = { params: Promise<{ number: string }> };

export default async function WaiterTablesPage({ params }: Props) {
  const { number } = await params;
  const result = await resolveWaiter(number);

  if (!result.ok) {
    return (
      <SectionShell title="Waiter Section" description="Enter your employee number to see your tables.">
        <WaiterRefused message={result.message} />
      </SectionShell>
    );
  }

  const me = result.employee;
  const { view } = await loadWaiterScreen(me);

  return (
    <SectionShell title={employeeLabel(me)} description={`${ROLE_LABEL[me.role]}. Choose a table with seated guests.`}>
      <div className="mb-6">
        <Link href="/waiter" className={buttonClasses("secondary")}>
          Not you? Change number
        </Link>
      </div>
      <WaiterTables view={view} basePath={waiterPath(me)} />
    </SectionShell>
  );
}
