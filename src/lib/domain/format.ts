// Fixed text formats used in reasons, questions and change logs.

import { dayNumber } from "./dates";

export function fmtCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-01-02" becomes "Jan 2, 2027". Invalid input is returned unchanged. */
export function fmtDate(iso: string): string {
  if (dayNumber(iso) === null) return iso;
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** Whole dollars for display, half up: 165050 becomes "$1,651". Null is "Unknown". */
export function fmtDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Unknown";
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.floor((Math.abs(cents) + 50) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}`;
}

/** "2027-01-02" becomes "Jan 2". Invalid input is returned unchanged. */
export function fmtDay(iso: string): string {
  if (dayNumber(iso) === null) return iso;
  const [, month, day] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day}`;
}

/**
 * Two dates as one phrase: "Jan 2 to Aug 13". With only one end it is "From Jan 2" or "Until Aug 13",
 * and with neither it is null, so the caller leaves the phrase out instead of printing Unknown.
 */
export function fmtDayRange(from: string | null | undefined, to: string | null | undefined): string | null {
  if (from && to) return `${fmtDay(from)} to ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  if (to) return `Until ${fmtDay(to)}`;
  return null;
}

/**
 * Display form of a sentence written by the domain code: cents and years are dropped
 * ("$2,500.00" becomes "$2,500", "Jan 2, 2027" becomes "Jan 2"). The stored reasons keep their full form.
 */
export function tidyText(text: string): string {
  return text
    .replace(/\$(\d[\d,]*)\.(\d{2})\b/g, (_whole, dollars: string, cents: string) =>
      fmtDollars(Number(dollars.replace(/,/g, "")) * 100 + Number(cents)),
    )
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), 20\d{2}\b/g, "$1 $2");
}

/** Two decimals, half up, for weights such as 0.125 (shown as 0.13). */
export function fmtWeight(weight: number): string {
  return (Math.round((weight + Number.EPSILON) * 100) / 100).toFixed(2);
}
