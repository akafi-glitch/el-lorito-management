import type { Metadata } from "next";
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { HistoryReprint } from "@/features/history/components/history-reprint";
import { loadTicketByNumber } from "@/features/tickets/queries";
import { ticketNumberParamSchema } from "@/features/tickets/schema";
import { TicketView } from "@/features/tickets/components/ticket-view";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Ticket" };

type Props = { params: Promise<{ ticket: string }> };

const REASON = {
  open: "Not finalized: no customer receipt was confirmed for this ticket.",
  printed: "Printed: locked for good.",
  finalized: "Finalized: the customer receipt was printed. It can't be changed.",
  cancelled: "This ticket was cancelled.",
} as const;

/** One saved ticket, read-only, and another copy of its receipt. */
export default async function HistoryTicketPage({ params }: Props) {
  const parsed = ticketNumberParamSchema.safeParse((await params).ticket);
  const ticket = parsed.success ? await loadTicketByNumber(parsed.data) : null;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/manage/history" className={buttonClasses("secondary", "self-start")}>
        Back to Order History
      </Link>
      {ticket ? (
        <TicketView
          ticket={ticket}
          reason={REASON[ticket.status]}
          actions={
            ticket.status === "finalized" || ticket.status === "printed" ? (
              <HistoryReprint ticketId={ticket.id} paperWidthMm={serverEnv().RECEIPT_PAPER_WIDTH_MM} />
            ) : null
          }
        />
      ) : (
        <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
          No ticket has that number.
        </p>
      )}
    </div>
  );
}
