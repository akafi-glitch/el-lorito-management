"use client";

import { buttonClasses } from "@/components/ui/button";

import type { FloorTable } from "../layout";

import { Modal } from "./modal";

type TableDialogProps = {
  table: FloorTable;
  busy: boolean;
  onClose: () => void;
  onChipsServed: (table: FloorTable) => void;
  onClear: (table: FloorTable) => void;
  onOpenSection: (table: FloorTable) => void;
};

/** What a tap on a seated table (or a closed one) does. */
export function TableDialog({ table, busy, onClose, onChipsServed, onClear, onOpenSection }: TableDialogProps) {
  const visit = table.visit;
  const title = visit ? visit.tableLabels.join(" + ") : table.label;
  const guests = visit ? (visit.guestCount === 1 ? "1 guest" : `${visit.guestCount} guests`) : "";

  if (!visit) {
    return (
      <Modal title={`Section ${table.section.name} is closed`} onClose={onClose}>
        <p className="text-lg">Open the section to seat guests at {table.label}.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" disabled={busy} onClick={() => onOpenSection(table)} className={buttonClasses("primary", "flex-1")}>
            Open section {table.section.name}
          </button>
          <button type="button" onClick={onClose} className={buttonClasses("secondary", "flex-1")}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  if (!visit.chipsServed) {
    return (
      <Modal title={title} onClose={onClose}>
        <p className="text-lg">
          {guests}. <span className="font-semibold">Needs chips.</span>
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" disabled={busy} onClick={() => onChipsServed(table)} className={buttonClasses("primary", "flex-1 text-lg")}>
            {busy ? "Saving…" : "Chips served"}
          </button>
          <button type="button" onClick={onClose} className={buttonClasses("secondary", "flex-1")}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-base text-muted">{guests}. Chips served.</p>
      <p className="mt-3 text-2xl font-bold">Is the table cleaned?</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" disabled={busy} onClick={() => onClear(table)} className={buttonClasses("primary", "flex-1 text-lg")}>
          {busy ? "Clearing…" : "Yes, clear table"}
        </button>
        <button type="button" onClick={onClose} className={buttonClasses("secondary", "flex-1 text-lg")}>
          No
        </button>
      </div>
    </Modal>
  );
}
