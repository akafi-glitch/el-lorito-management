"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { fetchMenuData } from "@/features/menu/use-menu-data";
import { KITCHEN_MARK_TEXT } from "@/features/tickets/rules";

import { tablePath, type PickerSection } from "../rules";

type TablePickerProps = {
  /** The sections a manager gave this waiter this shift, with their tables. */
  mine: PickerSection[];
  /** Every other section. Any waiter can take an order anywhere. */
  others: PickerSection[];
  /** "/waiter/01": where this waiter's links start. */
  basePath: string;
  menuVersion: number;
};

function TableGrid({ tables, basePath }: { tables: PickerSection["tables"]; basePath: string }) {
  return (
    <ul className="grid grid-cols-3 gap-3">
      {tables.map((table) => (
        <li key={table.code}>
          <Link
            href={tablePath(basePath, table.code)}
            className={`flex h-full min-h-16 flex-col items-center justify-center rounded-xl border-2 px-2 py-1 text-center text-xl font-bold active:scale-95 ${
              table.kitchen === "printed"
                ? "border-status-kitchen bg-status-kitchen text-white"
                : table.kitchen === "saved"
                  ? "border-status-saved bg-status-saved text-white"
                  : "border-glaze bg-paper text-ink hover:border-leaf"
            }`}
          >
            {table.label}
            {table.kitchen ? <span className="text-xs font-semibold">{KITCHEN_MARK_TEXT[table.kitchen]}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The waiter's own tables, straight away. Another section is one tap further, for anyone. */
export function TablePicker({ mine, others, basePath, menuVersion }: TablePickerProps) {
  const [wantsOther, setWantsOther] = useState(false);
  const [sectionCode, setSectionCode] = useState("");
  const section = others.find((candidate) => candidate.code === sectionCode);
  const showOthers = mine.length === 0 || wantsOther;

  // Have the menu on the device before the waiter gets to the table.
  useEffect(() => {
    void fetchMenuData(menuVersion).catch(() => {});
  }, [menuVersion]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      {mine.length > 0 ? (
        <nav aria-labelledby="my-tables-heading" className="flex flex-col gap-3" data-testid="my-tables">
          <h2 id="my-tables-heading" className="text-lg font-semibold text-ink">
            Your tables
          </h2>
          {mine.map((own) => (
            <div key={own.code} className="flex flex-col gap-1.5">
              <h3 className="text-base font-bold text-muted">Section {own.name}</h3>
              <TableGrid tables={own.tables} basePath={basePath} />
            </div>
          ))}
        </nav>
      ) : (
        <p className="rounded-xl border-2 border-glaze bg-paper px-4 py-3 text-base font-semibold text-ink">
          A manager hasn&apos;t given you a section this shift. You can still take orders from any section.
        </p>
      )}

      {mine.length > 0 ? (
        <button
          type="button"
          aria-expanded={wantsOther}
          onClick={() => setWantsOther((current) => !current)}
          className={buttonClasses("secondary", "w-full")}
        >
          Want to take order from another section?
        </button>
      ) : null}

      {showOthers ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pick-section" className="text-lg font-semibold text-ink">
              Select Section
            </label>
            <select
              id="pick-section"
              className="min-h-14 w-full rounded-xl border-2 border-glaze bg-paper px-4 text-lg font-semibold text-ink focus:border-leaf focus:outline-none"
              value={sectionCode}
              onChange={(event) => setSectionCode(event.target.value)}
            >
              <option value="">Choose a section…</option>
              {others.map((candidate) => (
                <option key={candidate.code} value={candidate.code}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>

          {section ? (
            <nav aria-labelledby="pick-table-heading" className="flex flex-col gap-1.5">
              <h2 id="pick-table-heading" className="text-lg font-semibold text-ink">
                Select Table
              </h2>
              <TableGrid tables={section.tables} basePath={basePath} />
            </nav>
          ) : (
            <p className="text-base text-muted">Choose a section to see its tables.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
