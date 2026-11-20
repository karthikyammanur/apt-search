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
