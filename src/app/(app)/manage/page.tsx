import type { Metadata } from "next";

import { ShiftAndBoard } from "@/features/staff/components/shift-and-board";
import { loadStaffBoard } from "@/features/staff/queries";

export const metadata: Metadata = { title: "Management" };

export default async function ManagePage() {
  const board = await loadStaffBoard();
  return <ShiftAndBoard board={board} />;
}
