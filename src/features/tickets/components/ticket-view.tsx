import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { TotalsBlock } from "@/features/billing/components/totals-block";
import { formatCents } from "@/features/menu/money";

import { staffLabel, STATUS_TEXT } from "../rules";
import type { SavedTicket } from "../types";

/** A ticket that can't be changed any more (printed, cancelled, or the table was cleared). */
export function TicketView({ ticket, reason, newTicketHref }: { ticket: SavedTicket; reason: string; newTicketHref: string | null }) {
  return (
    <section aria-labelledby="ticket-view-heading" className="mx-auto w-full max-w-xl rounded-2xl border border-glaze bg-paper p-5">
      <h2 id="ticket-view-heading" className="text-2xl font-bold text-ink">
        Ticket #{ticket.number}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {staffLabel(ticket.maker)} · {ticket.createdAt} · {STATUS_TEXT[ticket.status]}
      </p>
      <p className="mt-3 rounded-lg bg-tile px-3 py-2 text-base font-semibold text-ink">{reason}</p>
      <ul className="mt-4 flex flex-col divide-y divide-glaze">
        {ticket.lines.map((line) => (
          <li key={line.itemId} className="flex justify-between gap-3 py-2">
            <span className="text-ink">
              {line.quantity} × {line.name} <span className="text-sm text-muted">({formatCents(line.unitCents)})</span>
            </span>
            <span className="font-semibold tabular-nums text-ink">{formatCents(line.totalCents)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t-2 border-ink/20 pt-3">
        <TotalsBlock totals={ticket.totals} />
      </div>
      {newTicketHref ? (
        <Link href={newTicketHref} className={buttonClasses("primary", "mt-5 w-full")}>
          Start a new ticket
        </Link>
      ) : null}
    </section>
  );
}
