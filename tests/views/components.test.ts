import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { createDb } from "@/db";
import { seedDemo } from "@/db/demo";
import { runMigrations } from "@/db/run-migrations";
import { tidyText } from "@/lib/domain";
import { getBoard, getListing, type ListingDetail, type BoardItem } from "@/lib/queries";
import {
  CostTable,
  ListingCard,
  ProvenanceChip,
  RequirementsChecklist,
  money,
} from "@/components/listing-values";

let detail: ListingDetail;
let item: BoardItem;
beforeAll(async () => {
  const db = createDb(":memory:");
  await runMigrations(db);
  await seedDemo(db, { now: new Date("2026-12-01T16:00:00Z") });
  item = (await getBoard({}, { db })).items[0]!;
  detail = (await getListing(item.id, { db }))!;
});
describe("demo-backed display components", () => {
  it("links the row to its listing and preserves stored numbers", () => {
    const html = renderToStaticMarkup(h(ListingCard, { item }));
    expect(html).toContain(`/listing/${item.id}`);
    expect(html).toContain(money(item.allInMonthlyCents));
    expect(html).toContain(String(item.score));
    expect(
      renderToStaticMarkup(
        h(ListingCard, {
          item: { ...item, allInMonthlyCents: null, commuteMinutes: null, score: null },
        }),
      ),
    ).toContain("Unknown");
  });
  it("shows every cost line, its source and stored total", () => {
    const html = renderToStaticMarkup(h(CostTable, { detail }));
    for (const line of detail.cost!.lines) {
      expect(html).toContain(line.label);
      expect(html).toContain(money(line.monthlyCents));
    }
    expect(html).toContain(money(detail.allInMonthlyCents));
    expect(html).toContain("refundable deposit");
  });
  it("folds the actual checks and reasons under the bucket summary", () => {
    const html = renderToStaticMarkup(h(RequirementsChecklist, { detail }));
    expect(html).toContain("<details");
    expect(html).toContain(`Passes all ${detail.filters!.results.length} requirements`);
    for (const result of detail.filters!.results)
      expect(html).toContain(tidyText(result.reason).replaceAll("&", "&amp;").replaceAll("'", "&#x27;"));
    expect(
      renderToStaticMarkup(
        h(RequirementsChecklist, {
          detail: {
            ...detail,
            bucket: "likely",
            filters: { ...detail.filters!, scamNote: "scam checks pending" },
          },
        }),
      ),
    ).toContain("Likely passes, confirm fees with landlord, scam checks pending");
  });
  it.each([
    ["landlord", "landlord said"],
    ["me", "you"],
    ["listing", "listing"],
    ["estimate", "estimate"],
    [null, "Unknown"],
  ])("labels provenance %s", (source, label) => {
    expect(renderToStaticMarkup(h(ProvenanceChip, { source }))).toContain(`· ${label}`);
  });
});
