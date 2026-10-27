import { SectionShell } from "@/components/section-shell";
import { ManageTabs } from "@/features/staff/components/manage-tabs";

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectionShell title="Management" description="Shifts, who works where, employees, and sign-in accounts.">
      <div className="flex flex-col gap-6">
        <ManageTabs />
        {children}
      </div>
    </SectionShell>
  );
}
