import type { Metadata } from "next";
import Link from "next/link";

import { SectionShell } from "@/components/section-shell";
import { buttonClasses } from "@/components/ui/button";
import { allTables } from "@/features/floor/layout";
import { loadFloorMap } from "@/features/floor/queries";
import { STATUS_LABEL } from "@/features/floor/status";
import { ReprintButton } from "@/features/printing/components/reprint-button";
import { employeeLabel } from "@/features/staff/rules";
import { loadVersions } from "@/features/sync/queries";
import { TableOrderScreen } from "@/features/tickets/components/table-order-screen";
import { SavedTicketPanelForOldTicket } from "@/features/tickets/components/old-ticket-panel";
import { TicketList } from "@/features/tickets/components/ticket-list";
import { TicketView } from "@/features/tickets/components/ticket-view";
import { loadVisitTickets } from "@/features/tickets/queries";
import { currentTicket, withTicket } from "@/features/tickets/rules";
import { ticketNumberParamSchema } from "@/features/tickets/schema";
import { SeatHere } from "@/features/waiter/components/seat-here";
import { WaiterRefused } from "@/features/waiter/components/waiter-refused";
import { resolveWaiter } from "@/features/waiter/resolve";
import { tablePath, waiterPath } from "@/features/waiter/rules";
import { tableCodeSchema } from "@/features/waiter/schema";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Table" };

type Props = {
  params: Promise<{ number: string; code: string }>;
  searchParams: Promise<{ ticket?: string | string[] }>;
};

export default async function WaiterTablePage({ params, searchParams }: Props) {
  const [{ number, code }, query] = await Promise.all([params, searchParams]);
  const result = await resolveWaiter(number);
  // Versions before the data (see floor/page.tsx), so this screen follows changes from other devices.
  const versions = result.ok ? await loadVersions() : null;
  const shell = (title: string, children: React.ReactNode) => (
    <SectionShell
      title={title}
      description="Waiter Section"
      live={versions ? { watch: ["floor", "tickets", "menu"], versions } : undefined}
    >
      {children}
    </SectionShell>
  );

  if (!result.ok) return shell("Waiter Section", <WaiterRefused message={result.message} />);
  const me = result.employee;
  const back = waiterPath(me);

  const parsedCode = tableCodeSchema.safeParse(code);
  const floor = await loadFloorMap();
  const table = parsedCode.success ? allTables(floor).find((t) => t.code === parsedCode.data) : undefined;

  const backLink = (
    <Link href={back} className={buttonClasses("secondary")}>
      Choose another table
    </Link>
  );

  if (!table) {
    return shell("Table not found", <Problem message="That table isn't on the floor plan." action={backLink} />);
  }

  if (!table.visit) {
    return shell(
      table.label,
      <div className="flex flex-col items-center gap-6">
        <SeatHere tableCode={table.code} tableLabel={table.label} />
        {backLink}
      </div>,
    );
  }

  const visit = table.visit;
  const guests = visit.guestCount === 1 ? "1 guest" : `${visit.guestCount} guests`;
  const tableHref = tablePath(back, table.code);
  const paperWidthMm = serverEnv().RECEIPT_PAPER_WIDTH_MM;
  const tickets = await loadVisitTickets(visit.visitId);
  const current = currentTicket(tickets);
  const others = tickets.filter((ticket) => ticket.id !== current?.id);

  // ?ticket=1001 opens another ticket of this group.
  const wanted = query.ticket === undefined ? null : ticketNumberParamSchema.safeParse(query.ticket);
  const selected = wanted?.success ? (others.find((t) => t.number === wanted.data) ?? null) : null;

  return shell(
    `Table ${visit.tableLabels.join(" + ")}`,
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-3 gap-3 rounded-2xl border border-glaze bg-paper p-4">
        <div>
          <dt className="text-sm font-semibold text-muted">Waiter</dt>
          <dd className="text-lg font-bold text-ink">{employeeLabel(me)}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">Guests</dt>
          <dd className="text-lg font-bold text-ink">{guests}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">Status</dt>
          <dd className="text-lg font-bold text-ink">{STATUS_LABEL[table.status]}</dd>
        </div>
      </dl>

      {others.length > 0 ? <TicketList tickets={others} selected={selected?.number ?? null} tableHref={tableHref} /> : null}

      {selected ? (
        <>
          {selected.status === "open" ? (
            <SavedTicketPanelForOldTicket ticket={selected} visitId={visit.visitId} employeeNumber={me.number} paperWidthMm={paperWidthMm} />
          ) : (
            <TicketView
              ticket={selected}
              reason={selected.status === "printed" ? "Printed: locked for good." : "This ticket was cancelled."}
              actions={
                selected.status === "printed" ? <ReprintButton employeeNumber={me.number} paperWidthMm={paperWidthMm} ticketId={selected.id} /> : null
              }
            />
          )}
          <Link href={withTicket(tableHref, null)} className={buttonClasses("secondary", "self-start")}>
            Back to this table&apos;s ticket
          </Link>
        </>
      ) : (
        <TableOrderScreen
          employeeNumber={me.number}
          visitId={visit.visitId}
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
