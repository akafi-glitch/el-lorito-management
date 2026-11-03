import type { Metadata } from "next";
import Link from "next/link";

import { SectionShell } from "@/components/section-shell";
import { buttonClasses } from "@/components/ui/button";
import { ReprintButton } from "@/features/printing/components/reprint-button";
import { employeeLabel } from "@/features/staff/rules";
import { loadVersions } from "@/features/sync/queries";
import { TableOrderScreen } from "@/features/tickets/components/table-order-screen";
import { SavedTicketPanelForOldTicket } from "@/features/tickets/components/old-ticket-panel";
import { TicketList } from "@/features/tickets/components/ticket-list";
import { TicketView } from "@/features/tickets/components/ticket-view";
import { loadTableTickets } from "@/features/tickets/queries";
import { currentTicket, KITCHEN_MARK_TEXT, ticketKitchenMark, withTicket } from "@/features/tickets/rules";
import { ticketNumberParamSchema } from "@/features/tickets/schema";
import { WaiterRefused } from "@/features/waiter/components/waiter-refused";
import { findTableByCode } from "@/features/waiter/queries";
import { resolveWaiter } from "@/features/waiter/resolve";
import { tablePath, waiterPath } from "@/features/waiter/rules";
import { tableCodeSchema } from "@/features/waiter/schema";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Table" };

type Props = {
  params: Promise<{ number: string; code: string }>;
  searchParams: Promise<{ ticket?: string | string[] }>;
};

const REASON = {
  open: "Not finalized yet.",
  printed: "Printed: locked for good.",
  finalized: "Finalized: the customer receipt was printed. It can't be changed.",
  cancelled: "This ticket was cancelled.",
} as const;

/** A table's order page. It doesn't look at the Floor: anyone seated or not, the waiter just orders. */
export default async function WaiterTablePage({ params, searchParams }: Props) {
  const [{ number, code }, query] = await Promise.all([params, searchParams]);
  const result = await resolveWaiter(number);
  // Versions before the data (see floor/page.tsx), so this screen follows changes from other devices.
  const versions = result.ok ? await loadVersions() : null;
  const shell = (title: string, children: React.ReactNode) => (
    <SectionShell title={title} description="Waiter Section" live={versions ? { watch: ["tickets", "menu", "staff"], versions } : undefined}>
      {children}
    </SectionShell>
  );

  if (!result.ok) return shell("Waiter Section", <WaiterRefused message={result.message} />);
  const me = result.employee;
  const back = waiterPath(me);

  const parsedCode = tableCodeSchema.safeParse(code);
  const table = parsedCode.success ? await findTableByCode(parsedCode.data) : null;

  const backLink = (
    <Link href={back} className={buttonClasses("secondary")}>
      Choose another table
    </Link>
  );

  if (!table) {
    return shell("Table not found", <Problem message="That table isn't on the floor plan." action={backLink} />);
  }

  const tableHref = tablePath(back, table.code);
  const paperWidthMm = serverEnv().RECEIPT_PAPER_WIDTH_MM;
  const tickets = await loadTableTickets(table.id);
  const current = currentTicket(tickets);
  const others = tickets.filter((ticket) => ticket.id !== current?.id);
  const mark = ticketKitchenMark(current);

  // ?ticket=1001 opens an earlier ticket of this table.
  const wanted = query.ticket === undefined ? null : ticketNumberParamSchema.safeParse(query.ticket);
  const selected = wanted?.success ? (others.find((t) => t.number === wanted.data) ?? null) : null;

  return shell(
    `Table ${table.label}`,
    <div className="flex flex-col gap-6">
      {mark ? (
        <p className={`self-start rounded-lg px-3 py-1.5 text-base font-bold text-white ${mark === "printed" ? "bg-status-kitchen" : "bg-status-saved"}`}>
          {KITCHEN_MARK_TEXT[mark]}
        </p>
      ) : null}
      <p className="rounded-2xl border border-glaze bg-paper p-4 text-lg font-bold text-ink">
        <span className="text-sm font-semibold text-muted">Waiter </span>
        {employeeLabel(me)}
      </p>

      {others.length > 0 ? <TicketList tickets={others} selected={selected?.number ?? null} tableHref={tableHref} /> : null}

      {selected ? (
        <>
          {selected.status === "open" ? (
            <SavedTicketPanelForOldTicket ticket={selected} employeeNumber={me.number} paperWidthMm={paperWidthMm} />
          ) : (
            <TicketView
              ticket={selected}
              reason={REASON[selected.status]}
              actions={
                selected.status === "cancelled" ? null : <ReprintButton employeeNumber={me.number} paperWidthMm={paperWidthMm} ticketId={selected.id} />
              }
            />
          )}
          <Link href={withTicket(tableHref, null)} className={buttonClasses("secondary", "self-start")}>
            Back to this table&apos;s order
          </Link>
        </>
      ) : (
        <TableOrderScreen
          employeeNumber={me.number}
          tableCode={table.code}
          ticket={current}
          menuVersion={versions!.menu}
          timeZone={serverEnv().APP_TIME_ZONE}
          nowIso={new Date().toISOString()}
          paperWidthMm={paperWidthMm}
        />
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {backLink}
        <Link href="/" className={buttonClasses("primary")}>
          Done: back to Home
        </Link>
      </div>
    </div>,
  );
}

function Problem({ message, action }: { message: string; action: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
        {message}
      </p>
      {action}
    </div>
  );
}
