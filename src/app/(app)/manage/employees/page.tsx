import type { Metadata } from "next";

import { EmployeesManager } from "@/features/staff/components/employees-manager";
import { loadEmployees } from "@/features/staff/queries";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const employees = await loadEmployees();
  return <EmployeesManager employees={employees} />;
}
