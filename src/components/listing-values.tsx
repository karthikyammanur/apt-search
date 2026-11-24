import Link from "next/link";
import type { BoardItem, ListingDetail } from "@/lib/queries";
import { Photo } from "./photos";

export const money = (cents: number | null | undefined) =>
  cents == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(cents / 100);
export const minutes = (value: number | null | undefined) =>
  value == null ? "Unknown" : `${value} min`;
export const FILTER_LABELS = {
  budget: "Budget",
  move_in: "Move-in date",
  lease: "Lease length",
  commute: "Commute",
  transit_access: "Transit access",
  private_bed_bath: "Private bedroom and bathroom",
  furnished: "Furnished",
  scam_checks: "Scam checks",
  roommates: "Roommates",
} as const;
export function ProvenanceChip({ source }: { source: string | null }) {
  const estimate = source?.includes("estimate");
  return (
    <span className="provenance" data-provenance={estimate ? "estimate" : source}>
      {" "}
      · {source === "landlord" ? "landlord said" : source === "me" ? "you" : (source ?? "Unknown")}
    </span>
  );
}
export function ListingCard({ item }: { item: BoardItem }) {
  return (
    <li className="border-b border-line">
      <div className="flex items-center gap-4 py-[18px]">
        <Photo url={item.photoUrl} originalUrl={item.url} thumbnail />
        <Link
          href={`/listing/${item.id}`}
          className="min-w-0 flex-1 flex-col !items-start justify-center no-underline"
        >
          <span className="font-medium break-words">{item.title ?? "Untitled listing"}</span>
          <span className="mt-1 text-sm text-muted-foreground">
            {money(item.allInMonthlyCents)} a month · {minutes(item.commuteMinutes)} ·{" "}
            {item.city ?? "Unknown"}
          </span>
          {item.userStatus !== "none" && (
            <span className="text-sm text-primary">
              {item.userStatus === "shortlisted" ? "Shortlisted" : "Not for me"}
            </span>
          )}
        </Link>
        <span className="text-xl font-semibold text-primary">{item.score ?? "Unknown"}</span>
      </div>
    </li>
  );
}
export function RequirementsChecklist({ detail }: { detail: ListingDetail }) {
  const results = detail.filters?.results ?? [];
  const label =
    detail.bucket === "pass"
      ? `Passes all ${results.length} requirements`
      : detail.bucket === "likely"
        ? "Likely passes, confirm fees with landlord"
        : detail.bucket === "fail"
          ? "Fails requirements"
          : "Needs info";
  return (
    <details className="mt-7 border-y border-line">
      <summary className="flex min-h-[52px] cursor-pointer items-center">
        <span className="bucket" data-bucket={detail.bucket}>
          {label}
          {detail.filters?.scamNote ? `, ${detail.filters.scamNote}` : ""}
        </span>
      </summary>
      <ul className="mb-4 space-y-2 text-sm">
        {results.map((check) => (
          <li key={check.filter}>
            <span className={check.status === "unknown" ? "text-attention" : ""}>
              {FILTER_LABELS[check.filter]}: {check.status === "unknown" ? "Unknown" : check.status}
            </span>{" "}
            · {check.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}
export function CostTable({ detail }: { detail: ListingDetail }) {
  return (
    <div>
      {detail.cost?.lines.map((line) => (
        <div key={line.key} className="flex justify-between gap-4 py-2">
          <span>
            {line.label}
            <ProvenanceChip source={line.source} />
            {line.note && <small className="block text-muted-foreground">{line.note}</small>}
          </span>
          <span className="shrink-0">{money(line.monthlyCents)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-line py-3 font-semibold">
        <span>All-in</span>
        <span>{money(detail.allInMonthlyCents)}</span>
      </div>
      <div className="flex justify-between gap-4 text-sm text-muted-foreground">
        <span>With transit pass</span>
        <span>{money(detail.allInPlusTransitCents)}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {detail.cost?.transitPass?.status === "estimated"
          ? detail.cost.transitPass.detail
          : "Transit pass: Unknown"}
      </p>
      <div className="mt-2 flex justify-between gap-4 text-sm text-muted-foreground">
        <span>Due at move-in, incl. refundable deposit</span>
        <span>{money(detail.cost?.upfrontCashCents)}</span>
      </div>
    </div>
  );
}
