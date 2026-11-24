import Link from "next/link";
import { z } from "zod";
import { compareListings } from "@/lib/queries";
import { ViewShell } from "@/components/view-shell";
import { money } from "@/components/listing-values";
import { requireLogin } from "../auth";

export default async function Compare({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  await requireLogin();
  const params = await searchParams;
  const ids = z
    .array(z.coerce.number().int().positive())
    .min(2)
    .max(3)
    .safeParse(params.ids?.split(","));
  if (!ids.success)
    return (
      <ViewShell>
        <h1>Compare</h1>
        <p className="mt-4">Choose 2 or 3 listings from the list to compare.</p>
        <Link href="/">Back to listings</Link>
      </ViewShell>
    );
  const comparison = await compareListings(ids.data);
  return (
    <ViewShell>
      <h1>Compare</h1>
      {comparison.missing.length > 0 && (
        <p className="mt-4 text-attention">Some listings were not found.</p>
      )}
      <div role="table" aria-label="Listing comparison" className="mt-8 text-sm">
        <div
          role="row"
          className="grid gap-3 border-b border-line py-3"
          style={{
            gridTemplateColumns: `repeat(${comparison.listings.length || 1}, minmax(0,1fr))`,
          }}
        >
          {comparison.listings.map((d) => (
            <Link
              role="columnheader"
              key={d.listing.id}
              href={`/listing/${d.listing.id}`}
              className="break-words font-medium"
            >
              {d.listing.title ?? "Untitled listing"}
            </Link>
          ))}
        </div>
        {comparison.rows.map((row) => {
          const numbers = row.values.filter((value): value is number => typeof value === "number");
          const best = numbers.length
            ? row.key === "score"
              ? Math.max(...numbers)
              : Math.min(...numbers)
            : null;
          return (
            <div key={row.key} role="row" className="border-b border-line py-4">
              <div role="rowheader" className="mb-2 text-muted-foreground">
                {row.label.replace(" (cents)", "")}
              </div>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${comparison.listings.length || 1},minmax(0,1fr))`,
                }}
              >
                {row.values.map((value, i) => (
                  <div
                    role="cell"
                    key={i}
                    className={`break-words ${value !== null && (value === best || value === "pass" || value === true) ? "text-primary" : ""}`}
                  >
                    {value === null
                      ? "Unknown"
                      : typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : row.label.includes("cents") && typeof value === "number"
                          ? money(value)
                          : String(value)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ViewShell>
  );
}
