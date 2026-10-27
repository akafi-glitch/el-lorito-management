import type { FloorCombination, FloorTable, SectionInfo } from "@/features/floor/layout";

/**
 * Seating suggestions (owner rules, Oct 26, 2026). Pure code: same input, same answer, easy to test.
 *
 * 6 or fewer guests: follow the rotation (A, C, B, X(1), X(2), P) from the next section, skipping
 *   closed sections. In each section, the smallest free table that fits. One suggestion per section,
 *   so the first suggestion follows the rotation and the others are the next sections' best tables.
 * 7 or more guests: Party areas first (capacity not confirmed: shown with a reminder to check), then
 *   approved combinations whose tables are all free and whose chairs fit. Over 12 guests, only
 *   combinations allowed over twelve (X6 + X7 + X8).
 * Never suggested: occupied tables, closed sections, the Bar, regular tables with unknown capacity.
 * The database re-checks everything when the host confirms, so a stale screen can't double-seat.
 */

export const LARGE_PARTY_FROM = 7;
export const ONLY_SPECIAL_COMBINATIONS_ABOVE = 12;
export const MAX_GUESTS = 100;

export type SeatingOption = {
  kind: "table" | "party" | "combination";
  tableCodes: string[];
  label: string;
  /** Where it is, for the host ("Section A", "Party", "A + B"). */
  where: string;
  capacity: number | null;
  combinationCode: string | null;
  /** Shown under the option when the host should double-check something. */
  note: string | null;
};

export type SeatingInput = {
  guestCount: number;
  tables: readonly FloorTable[];
  sections: readonly SectionInfo[];
  combinations: readonly FloorCombination[];
  nextSectionCode: string | null;
};

export type SeatingAdvice = { options: SeatingOption[]; message: string | null };

export class GuestCountError extends Error {
  constructor() {
    super(`Enter a number of guests from 1 to ${MAX_GUESTS}.`);
    this.name = "GuestCountError";
  }
}

/** A table is free when nobody is seated there and its section is open. */
export function isFree(table: FloorTable): boolean {
  return table.visit === null && table.section.isOpen;
}

/** Dining sections in rotation order, starting at the next section, wrapping, open ones only. */
export function rotationFrom(sections: readonly SectionInfo[], nextSectionCode: string | null): SectionInfo[] {
  const rotation = sections
    .filter((section) => section.rotationOrder !== null)
    .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0));
  const start = Math.max(0, rotation.findIndex((section) => section.code === nextSectionCode));
  return [...rotation.slice(start), ...rotation.slice(0, start)].filter((section) => section.isOpen);
}

function smallParty(input: SeatingInput, limit: number): SeatingOption[] {
  const options: SeatingOption[] = [];
  for (const section of rotationFrom(input.sections, input.nextSectionCode)) {
    const best = input.tables
      .filter((table) => table.section.code === section.code && isFree(table))
      .filter((table) => table.capacity !== null && table.capacity >= input.guestCount)
      .sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0) || a.sortOrder - b.sortOrder)[0];
    if (best) {
      options.push({
        kind: "table",
        tableCodes: [best.code],
        label: best.label,
        where: `Section ${section.name}`,
        capacity: best.capacity,
        combinationCode: null,
        note: null,
      });
    }
    if (options.length >= limit) break;
  }
  return options;
}

function largeParty(input: SeatingInput, limit: number): SeatingOption[] {
  const partyAreas: SeatingOption[] = input.tables
    .filter((table) => table.section.kind === "party" && isFree(table))
    .filter((table) => table.capacity === null || table.capacity >= input.guestCount)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((table) => ({
      kind: "party",
      tableCodes: [table.code],
      label: table.label,
      where: "Party",
      capacity: table.capacity,
      combinationCode: null,
      note: table.capacity === null ? `Seats not set: check ${table.label} fits ${input.guestCount}.` : null,
    }));

  const byCode = new Map(input.tables.map((table) => [table.code, table]));
  const combinations: SeatingOption[] = input.combinations
    .map((combination, index) => ({ combination, index }))
    .filter(({ combination }) => input.guestCount <= ONLY_SPECIAL_COMBINATIONS_ABOVE || combination.allowsOverTwelve)
    .filter(({ combination }) => combination.capacity !== null && combination.capacity >= input.guestCount)
    .filter(({ combination }) =>
      combination.tableCodes.every((code) => {
        const table = byCode.get(code);
        return table !== undefined && isFree(table);
      }),
    )
    .sort((a, b) => (a.combination.capacity ?? 0) - (b.combination.capacity ?? 0) || a.index - b.index)
    .map(({ combination }) => {
      const sectionNames = [
        ...new Set(combination.tableCodes.map((code) => byCode.get(code)?.section.name ?? "")),
      ].filter(Boolean);
      return {
        kind: "combination",
        tableCodes: combination.tableCodes,
        label: combination.label,
        where: sectionNames.length === 1 ? `Section ${sectionNames[0]}` : `Sections ${sectionNames.join(" and ")}`,
        capacity: combination.capacity,
        combinationCode: combination.code,
        note: "Push the tables together.",
      };
    });

  return [...partyAreas, ...combinations].slice(0, limit);
}

export function recommendSeating(input: SeatingInput, limit = 3): SeatingAdvice {
  const guests = input.guestCount;
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) throw new GuestCountError();

  if (guests >= LARGE_PARTY_FROM) {
    const options = largeParty(input, limit);
    return {
      options,
      message:
        options.length > 0
          ? null
          : `No Party area or approved combination is free for ${guests} guests. Join tables by hand.`,
    };
  }

  const options = smallParty(input, limit);
  return {
    options,
    message:
      options.length > 0 ? null : `No open table fits ${guests} guests. Open a section or join tables by hand.`,
  };
}
