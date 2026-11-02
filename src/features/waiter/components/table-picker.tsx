"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { buttonClasses } from "@/components/ui/button";
import { fetchMenuData } from "@/features/menu/use-menu-data";

import { tablePath, type PickerSection } from "../rules";

const selectClass =
  "min-h-14 w-full rounded-xl border-2 border-glaze bg-paper px-4 text-lg font-semibold text-ink focus:border-leaf focus:outline-none disabled:opacity-60";

type TablePickerProps = {
  sections: PickerSection[];
  /** "/waiter/01": where this waiter's links start. */
  basePath: string;
  /** Picked first when the waiter has a section this shift. Any other can be chosen. */
  initialSection: string | null;
  menuVersion: number;
};

/** Choose a section, then one of its tables. Every table of every section is open to every waiter. */
export function TablePicker({ sections, basePath, initialSection, menuVersion }: TablePickerProps) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const [sectionCode, setSectionCode] = useState(initialSection ?? "");
  const [tableCode, setTableCode] = useState("");
  const tables = sections.find((section) => section.code === sectionCode)?.tables ?? [];
  // A table from another section (or one no longer listed) never stays chosen.
  const chosen = tables.some((table) => table.code === tableCode) ? tableCode : "";

  // Have the menu on the device before the waiter gets to the table.
  useEffect(() => {
    void fetchMenuData(menuVersion).catch(() => {});
  }, [menuVersion]);

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen) startOpening(() => router.push(tablePath(basePath, chosen)));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pick-section" className="text-lg font-semibold text-ink">
          Select Section
        </label>
        <select
          id="pick-section"
          className={selectClass}
          value={sectionCode}
          onChange={(event) => {
            setSectionCode(event.target.value);
            setTableCode("");
          }}
        >
          <option value="">Choose a section…</option>
          {sections.map((section) => (
            <option key={section.code} value={section.code}>
              {section.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="pick-table" className="text-lg font-semibold text-ink">
          Select Table
        </label>
        <select
          id="pick-table"
          className={selectClass}
          value={chosen}
          disabled={sectionCode === ""}
          onChange={(event) => setTableCode(event.target.value)}
        >
          <option value="">{sectionCode === "" ? "Choose a section first" : "Choose a table…"}</option>
          {tables.map((table) => (
            <option key={table.code} value={table.code}>
              {table.label} ({table.detail})
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={!chosen || opening} className={buttonClasses("primary", "min-h-16 text-xl")}>
        {opening ? "Opening…" : "Open table"}
      </button>
    </form>
  );
}
