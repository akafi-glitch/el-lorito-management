import type { Metadata } from "next";

import { LiveSync } from "@/features/sync/components/live-sync";
import { loadVersions } from "@/features/sync/queries";
import { EmployeesManager } from "@/features/staff/components/employees-manager";
import { loadEmployees } from "@/features/staff/queries";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const employees = await loadEmployees();
  return (
    <>
      <LiveSync watch={["staff"]} versions={versions} />
      <EmployeesManager employees={employees} />
    </>
  );
}
