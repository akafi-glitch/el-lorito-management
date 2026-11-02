"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NoticeBanner, type Notice } from "@/components/use-action-runner";
import { requestRefresh } from "@/features/sync/refresh";

import type { SavedTicket } from "../types";

import { SavedTicketPanel } from "./saved-ticket-panel";

/** An old-style open ticket: it can still be changed and billed while its group is seated. */
export function SavedTicketPanelForOldTicket({
  ticket,
  employeeNumber,
  paperWidthMm,
}: {
  ticket: SavedTicket;
  employeeNumber: string;
  paperWidthMm: 58 | 80;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <NoticeBanner notice={notice} />
      <SavedTicketPanel
        ticket={ticket}
        employeeNumber={employeeNumber}
        paperWidthMm={paperWidthMm}
        orderOnScreen={false}
        onNotice={setNotice}
        onChanged={() => {
          if (!requestRefresh()) router.refresh();
        }}
      />
    </div>
  );
}
