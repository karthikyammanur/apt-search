// What every tool gets: the query options (database and clock) and a way to build the intake
// pipeline's dependencies. Tests pass an in-memory database and stub model and map services.

import { fmtCents } from "@/lib/domain";
import type { IntakeDeps } from "@/lib/intake";
import type { BoardItem, QueryOptions } from "@/lib/queries";
import type { ListingRow, ToolError } from "../types";

export type ToolContext = {
  options?: QueryOptions;
  /** Built lazily, only when a listing is pasted. */
  intakeDeps?: () => Promise<IntakeDeps>;
};

export const UNKNOWN = "Unknown";

export const money = (cents: number | null): string => (cents === null ? UNKNOWN : fmtCents(cents));
export const minutes = (value: number | null): string => (value === null ? UNKNOWN : `${value} min`);

export const fail = (error: string): ToolError => ({ ok: false, error });

export function rowFromBoard(item: BoardItem): ListingRow {
  const note =
    item.bucket === "fail"
      ? item.failReason
      : item.bucket === "needs_info"
        ? `${item.openQuestions} open question${item.openQuestions === 1 ? "" : "s"}`
        : (item.likelyReason ?? (item.weakness ? `weakest: ${item.weakness.label}` : null));
  return {
    id: item.id,
    title: item.title,
    city: item.city,
    bucket: item.bucket,
    score: item.score,
    allInMonthlyCents: item.allInMonthlyCents,
    allInMonthly: money(item.allInMonthlyCents),
    commuteMinutes: item.commuteMinutes,
    commute: minutes(item.commuteMinutes),
    note,
    userStatus: item.userStatus,
  };
}
