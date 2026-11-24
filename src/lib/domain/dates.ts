// Calendar math on ISO dates (YYYY-MM-DD), in whole days, with no time zones involved.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for a valid ISO date, else null. */
export function dayNumber(iso: string): number | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return ms / MS_PER_DAY;
}

/** Whole days from `from` to `to`, or null if either date is invalid. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** Compare two valid ISO dates. Same format, so string order is date order. */
export function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** The ISO date `months` calendar months after `iso`, with the day clamped to the month's end. */
function addMonths(iso: string, months: number): string | null {
  const start = dayNumber(iso);
  if (start === null) return null;
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** A leftover of this many days or more past the last whole month rounds up to another month. */
export const ROUND_UP_DAYS = 15;

/**
 * Lease length in whole months from a start date to an end date, both inclusive, so
 * 2027-01-01 to 2027-08-31 is 8 months. Whole calendar months are counted from the start date
 * (a start on the 31st steps to the last day of shorter months), then a leftover of 15 days or
 * more rounds up. Null when either date is invalid or the result is under one month.
 */
export function leaseMonthsBetween(start: string, end: string): number | null {
  const endDay = dayNumber(end);
  if (dayNumber(start) === null || endDay === null) return null;
  const exclusiveEnd = endDay + 1;
  let whole = 0;
  for (;;) {
    const next = addMonths(start, whole + 1);
    const nextDay = next === null ? null : dayNumber(next);
    if (nextDay === null || nextDay > exclusiveEnd) break;
    whole += 1;
  }
  const reached = dayNumber(addMonths(start, whole) ?? "");
  if (reached === null) return null;
  const months = exclusiveEnd - reached >= ROUND_UP_DAYS ? whole + 1 : whole;
  return months >= 1 ? months : null;
}
