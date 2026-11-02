import type { Metadata } from "next";
import Link from "next/link";

import { SectionShell } from "@/components/section-shell";
import { buttonClasses } from "@/components/ui/button";
import { loadFloorMap } from "@/features/floor/queries";
import { ROLE_LABEL, employeeLabel } from "@/features/staff/rules";
import { loadVersions } from "@/features/sync/queries";
import { TablePicker } from "@/features/waiter/components/table-picker";
import { WaiterRefused } from "@/features/waiter/components/waiter-refused";
import { loadKitchenPrintedTables, loadWaitersBySection } from "@/features/waiter/queries";
import { resolveWaiter } from "@/features/waiter/resolve";
import { assignedSections, pickerSections, waiterPath } from "@/features/waiter/rules";

export const metadata: Metadata = { title: "Choose a table" };

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
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const [floor, waiters, printed] = await Promise.all([loadFloorMap(), loadWaitersBySection(), loadKitchenPrintedTables()]);
  const sections = pickerSections(floor, printed);
  const mine = assignedSections(sections, me, waiters);

  return (
    <SectionShell
      title={employeeLabel(me)}
      description={`${ROLE_LABEL[me.role]}. Any waiter can open any table.`}
      live={{ watch: ["staff", "tickets"], versions }}
    >
      <div className="flex flex-col gap-6">
        <TablePicker sections={sections} basePath={waiterPath(me)} initialSection={mine[0]?.code ?? null} menuVersion={versions.menu} />
        <p className="text-center text-base text-muted">
          {mine.length > 0 ? `Assigned this shift: ${mine.map((section) => section.name).join(", ")}` : "No section assigned this shift."}
        </p>
        <div className="flex justify-center">
          <Link href="/waiter" className={buttonClasses("secondary")}>
            Not you? Change number
          </Link>
        </div>
      </div>
    </SectionShell>
  );
}
