/**
 * Late pricing (owner decision, Oct 27, 2026): lunch items are served all day; from 3:00 PM
 * restaurant time each one costs $1.00 more. The time and amount are stored on the category.
 */

export type LatePricing = { fromMinutes: number; surchargeCents: number };

/** "15:00" or "15:00:00" (as the database sends a time) -> minutes after midnight. */
export function parseTimeOfDay(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) throw new Error(`Not a time of day: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Not a time of day: ${value}`);
  return hours * 60 + minutes;
}

/** Minutes after midnight on the restaurant's clock, whatever time zone the device is in. */
export function restaurantMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

export function isLate(late: LatePricing | null, now: Date, timeZone: string): boolean {
  return late !== null && restaurantMinutes(now, timeZone) >= late.fromMinutes;
}

/** The price to charge right now: the menu price, plus the late amount when it applies. */
export function currentPriceCents(priceCents: number, late: LatePricing | null, now: Date, timeZone: string): number {
  return isLate(late, now, timeZone) ? priceCents + (late?.surchargeCents ?? 0) : priceCents;
}

/** "3:00 PM" for showing the late time. */
export function formatTimeOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(mins).padStart(2, "0")} ${suffix}`;
}
