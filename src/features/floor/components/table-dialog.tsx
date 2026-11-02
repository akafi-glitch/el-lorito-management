"use client";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

import type { FloorTable } from "../layout";

type TableDialogProps = {
  table: FloorTable;
  busy: boolean;
  onClose: () => void;
  onUndoChips: (table: FloorTable) => void;
  onClear: (table: FloorTable) => void;
  onOpenSection: (table: FloorTable) => void;
};

/** What a tap on a red table (or a closed one) does. A yellow table doesn't ask: see floor-screen.tsx. */
export function TableDialog({ table, busy, onClose, onUndoChips, onClear, onOpenSection }: TableDialogProps) {
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

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-base text-muted">{guests}. Chips served.</p>
      <p className="mt-3 text-2xl font-bold">Is the table cleaned?</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" disabled={busy} onClick={() => onClear(table)} className={buttonClasses("primary", "flex-1 text-lg")}>
          Yes, clear table
        </button>
        <button type="button" onClick={onClose} className={buttonClasses("secondary", "flex-1 text-lg")}>
          No
        </button>
      </div>
      <button type="button" disabled={busy} onClick={() => onUndoChips(table)} className={buttonClasses("quiet", "mt-3 w-full")}>
        Undo chips served
      </button>
    </Modal>
  );
}
