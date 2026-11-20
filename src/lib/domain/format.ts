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

/** Two decimals, half up, for weights such as 0.125 (shown as 0.13). */
export function fmtWeight(weight: number): string {
  return (Math.round((weight + Number.EPSILON) * 100) / 100).toFixed(2);
}
