"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMenuData } from "@/features/menu/use-menu-data";

import { KITCHEN_MARK_TEXT } from "@/features/tickets/rules";

import { tablePath, type PickerSection } from "../rules";

type TablePickerProps = {
  sections: PickerSection[];
  /** "/waiter/01": where this waiter's links start. */
  basePath: string;
  /** Picked first when the waiter has a section this shift. Any other can be chosen. */
  initialSection: string | null;
  menuVersion: number;
};

/** Choose a section, then tap one of its tables to go straight to its order page. Open to every waiter. */
export function TablePicker({ sections, basePath, initialSection, menuVersion }: TablePickerProps) {
  const [sectionCode, setSectionCode] = useState(initialSection ?? "");
  const section = sections.find((candidate) => candidate.code === sectionCode);

  // Have the menu on the device before the waiter gets to the table.
  useEffect(() => {
    void fetchMenuData(menuVersion).catch(() => {});
  }, [menuVersion]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
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
          {sections.map((candidate) => (
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
          <ul className="grid grid-cols-3 gap-3">
            {section.tables.map((table) => (
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
        </nav>
      ) : (
        <p className="text-base text-muted">Choose a section to see its tables.</p>
      )}
    </div>
  );
}
