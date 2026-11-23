"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { fetchMenuData } from "@/features/menu/use-menu-data";
import { KITCHEN_MARK_TEXT } from "@/features/tickets/rules";

import { tablePath, toGoPath, type PickerSection } from "../rules";

const TO_GO_OPTION = "to-go-order";

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
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      {tables.map((table) => (
        <li key={table.code}>
          <Link
            href={tablePath(basePath, table.code)}
            className={`flex h-full min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 py-2 text-center text-3xl font-bold shadow-sm active:scale-95 lg:min-h-36 lg:text-4xl ${
              table.kitchen === "printed"
                ? "border-status-kitchen bg-status-kitchen text-white"
                : table.kitchen === "saved"
                  ? "border-status-saved bg-status-saved text-white"
                  : "border-glaze bg-paper text-ink hover:border-leaf"
            }`}
          >
            {table.label}
            {table.kitchen ? <span className="text-sm font-semibold">{KITCHEN_MARK_TEXT[table.kitchen]}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The waiter's own tables, straight away. Another section is one tap further, for anyone. */
export function TablePicker({ mine, others, basePath, menuVersion }: TablePickerProps) {
  const router = useRouter();
  const [wantsOther, setWantsOther] = useState(false);
  const [sectionCode, setSectionCode] = useState("");
  const section = others.find((candidate) => candidate.code === sectionCode);
  const showOthers = mine.length === 0 || wantsOther;

  // Have the menu on the device before the waiter gets to the table.
  useEffect(() => {
    void fetchMenuData(menuVersion).catch(() => {});
  }, [menuVersion]);

  return (
    <div className="mx-auto flex w-full flex-col gap-8">
      {mine.length > 0 ? (
        <nav aria-labelledby="my-tables-heading" className="flex flex-col gap-4" data-testid="my-tables">
          <h2 id="my-tables-heading" className="text-3xl font-bold text-ink">
            Your Section
          </h2>
          {mine.map((own) => (
            <div key={own.code} className="flex flex-col gap-2">
              <h3 className="text-xl font-bold text-muted">Section {own.name}</h3>
              <TableGrid tables={own.tables} basePath={basePath} />
            </div>
          ))}
        </nav>
      ) : (
        <p className="rounded-xl border-2 border-glaze bg-paper px-4 py-4 text-xl font-semibold text-ink">
          A manager hasn&apos;t given you a section this shift. You can still take orders from any section.
        </p>
      )}

      {mine.length > 0 ? (
        <button
          type="button"
          aria-expanded={wantsOther}
          onClick={() => setWantsOther((current) => !current)}
          className={buttonClasses("secondary", "mx-auto min-h-16 w-full max-w-xl text-xl")}
        >
          Want to take order from another section?
        </button>
      ) : null}

      {showOthers ? (
        <div className="flex flex-col gap-4">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-1.5">
            <label htmlFor="pick-section" className="text-xl font-semibold text-ink">
              Select Section
            </label>
            <select
              id="pick-section"
              className="min-h-16 w-full rounded-xl border-2 border-glaze bg-paper px-4 text-xl font-semibold text-ink focus:border-leaf focus:outline-none"
              value={sectionCode}
              onChange={(event) => {
                if (event.target.value === TO_GO_OPTION) router.push(toGoPath(basePath));
                else setSectionCode(event.target.value);
              }}
            >
              <option value="">Choose a section…</option>
              {others.map((candidate) => (
                <option key={candidate.code} value={candidate.code}>
                  {candidate.name}
                </option>
              ))}
              <option value={TO_GO_OPTION}>To-Go Order</option>
            </select>
          </div>

          {section ? (
            <nav aria-labelledby="pick-table-heading" className="flex flex-col gap-1.5">
              <h2 id="pick-table-heading" className="text-2xl font-bold text-ink">
                Select Table
              </h2>
              <TableGrid tables={section.tables} basePath={basePath} />
            </nav>
          ) : (
            <p className="text-center text-lg text-muted">Choose a section to see its tables.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
