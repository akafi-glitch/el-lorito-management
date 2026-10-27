import Link from "next/link";

import { formatCents } from "@/features/menu/money";

import { staffLabel, STATUS_TEXT, withTicket } from "../rules";
import type { SavedTicket } from "../types";

type TicketListProps = {
  tickets: SavedTicket[];
  selected: number | null;
  /** Table page link (keeps the "continue" confirmation). */
  tableHref: string;
};

/** Every ticket of this group, plus "New ticket". Tap one to open it. */
export function TicketList({ tickets, selected, tableHref }: TicketListProps) {
  return (
    <nav aria-labelledby="tickets-heading" className="rounded-2xl border border-glaze bg-paper p-4">
      <h2 id="tickets-heading" className="text-lg font-bold text-ink">
        Tickets for this table {tickets.length > 0 ? `(${tickets.length})` : ""}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        <li>
          <Link
            href={withTicket(tableHref, null)}
            aria-current={selected === null ? "page" : undefined}
            className={`flex min-h-14 items-center rounded-xl px-4 font-semibold ${
              selected === null ? "bg-cobalt text-white" : "border-2 border-dashed border-glaze text-cobalt hover:border-cobalt"
            }`}
          >
            + New ticket
          </Link>
        </li>
        {tickets.map((ticket) => {
          const current = ticket.number === selected;
          return (
            <li key={ticket.id}>
              <Link
                href={withTicket(tableHref, ticket.number)}
                aria-current={current ? "page" : undefined}
                aria-label={`Ticket ${ticket.number}, ${staffLabel(ticket.maker)}, ${ticket.itemCount} items, ${formatCents(ticket.totals.totalCents)} with tax, ${STATUS_TEXT[ticket.status]}`}
                className={`flex min-h-14 flex-col justify-center rounded-xl px-4 py-1 text-left ${
                  current ? "bg-cobalt text-white" : "border-2 border-glaze bg-paper text-ink hover:border-cobalt"
                } ${ticket.status === "cancelled" && !current ? "opacity-60 line-through" : ""}`}
              >
                <span className="font-bold">
                  #{ticket.number} · {formatCents(ticket.totals.totalCents)}
                </span>
                <span className={`text-xs ${current ? "text-white/85" : "text-muted"}`}>
                  {ticket.maker.name} · {ticket.createdTime} · {ticket.status === "open" ? "not printed" : ticket.status}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
