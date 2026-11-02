import { TotalsBlock } from "@/features/billing/components/totals-block";
import { formatCents } from "@/features/menu/money";

import { staffLabel, STATUS_TEXT } from "../rules";
import type { SavedTicket } from "../types";

/** A ticket shown read-only (cancelled, printed the old way, or from the history). */
export function TicketView({
  ticket,
  reason,
  actions,
}: {
  ticket: SavedTicket;
  reason: string;
  /** Extra buttons, such as printing a copy. */
  actions?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="ticket-view-heading" className="mx-auto w-full max-w-xl rounded-2xl border border-glaze bg-paper p-5">
      <h2 id="ticket-view-heading" className="text-2xl font-bold text-ink">
        Ticket #{ticket.number}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {staffLabel(ticket.maker)} · {ticket.createdAt} · {STATUS_TEXT[ticket.status]}
      </p>
      <p className="mt-3 rounded-lg bg-tile px-3 py-2 text-base font-semibold text-ink">{reason}</p>
      {ticket.batches
        .filter((batch) => batch.lines.length > 0)
        .map((batch) => (
          <div key={batch.id} className="mt-4">
            {ticket.batches.length > 1 ? (
              <h3 className="text-sm font-bold text-muted">
                Order {batch.no} · Waiter {batch.waiterNumber} · {batch.time}
              </h3>
            ) : null}
            <ul className="flex flex-col divide-y divide-glaze">
              {batch.lines.map((line) => (
                <li key={line.lineId} className="flex justify-between gap-3 py-2">
                  <span className="text-ink">
                    {line.quantity} × {line.name} <span className="text-sm text-muted">({formatCents(line.unitCents)})</span>
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{formatCents(line.totalCents)}</span>
                </li>
              ))}
            </ul>
            {batch.notes ? <p className="mt-1 text-sm font-semibold text-ink">Note: {batch.notes}</p> : null}
          </div>
        ))}
      <div className="mt-3 border-t-2 border-ink/20 pt-3">
        <TotalsBlock totals={ticket.totals} />
      </div>
      {actions ? <div className="mt-5">{actions}</div> : null}
    </section>
  );
}
