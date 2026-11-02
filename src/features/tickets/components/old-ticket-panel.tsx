"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NoticeBanner, type Notice } from "@/components/use-action-runner";
import { requestRefresh } from "@/features/sync/refresh";

import type { SavedTicket } from "../types";

import { SavedTicketPanel } from "./saved-ticket-panel";

/** An open ticket from before one group meant one ticket: it can still be changed and billed. */
export function SavedTicketPanelForOldTicket({
  ticket,
  visitId,
  employeeNumber,
  paperWidthMm,
}: {
  ticket: SavedTicket;
  visitId: number;
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
        visitId={visitId}
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
