import type { Metadata } from "next";

import { LiveSync } from "@/features/sync/components/live-sync";
import { loadVersions } from "@/features/sync/queries";
import { ShiftAndBoard } from "@/features/staff/components/shift-and-board";
import { loadStaffBoard } from "@/features/staff/queries";

export const metadata: Metadata = { title: "Management" };

export default async function ManagePage() {
  const versions = await loadVersions(); // before the data: see floor/page.tsx
  const board = await loadStaffBoard();
  return (
    <>
      <LiveSync watch={["staff"]} versions={versions} />
      <ShiftAndBoard board={board} />
    </>
  );
}
