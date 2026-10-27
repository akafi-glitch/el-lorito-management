import { z } from "zod";

/** What can change: matches public.sync_versions. */
export const TOPICS = ["floor", "staff", "menu", "tickets"] as const;
export type Topic = (typeof TOPICS)[number];
export type Versions = Readonly<Record<Topic, number>>;

export const versionsSchema = z.object({
  floor: z.number().int().nonnegative(),
  staff: z.number().int().nonnegative(),
  menu: z.number().int().nonnegative(),
  tickets: z.number().int().nonnegative(),
});

export const versionRowsSchema = z.array(z.object({ topic: z.enum(TOPICS), version: z.number().int().nonnegative() }));

/** Rows from public.sync_versions -> one object. A missing topic counts as 0. */
export function versionsFromRows(rows: z.infer<typeof versionRowsSchema>): Versions {
  const versions: Record<Topic, number> = { floor: 0, staff: 0, menu: 0, tickets: 0 };
  for (const row of rows) versions[row.topic] = row.version;
  return versions;
}

/** Topics this screen shows whose version moved past what the screen has. */
export function movedTopics(known: Versions, latest: Versions, watched: readonly Topic[]): Topic[] {
  return watched.filter((topic) => latest[topic] > known[topic]);
}

/** The newer of two sets of versions, topic by topic (versions only ever go up). */
export function newest(a: Versions, b: Versions): Versions {
  return {
    floor: Math.max(a.floor, b.floor),
    staff: Math.max(a.staff, b.staff),
    menu: Math.max(a.menu, b.menu),
    tickets: Math.max(a.tickets, b.tickets),
  };
}

export function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && (TOPICS as readonly string[]).includes(value);
}
