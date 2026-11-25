import Link from "next/link";
import { getBoard, getSettings, getMapPoints } from "@/lib/queries";
import { z } from "zod";
import { ViewShell } from "@/components/view-shell";
import { ListingCard, money } from "@/components/listing-values";
import { ListingMap } from "@/components/listing-map";
import { requireLogin } from "./auth";

export default async function Listings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLogin();
  const params = await searchParams;
  const bucket = z
    .enum(["pass", "likely", "needs_info", "fail"])
    .catch("pass")
    .parse(params.bucket);
  const status = params.status === "shortlisted" ? "shortlisted" : undefined;
  const board = await getBoard({ status });
  const items = board.items.filter((item) => item.bucket === bucket);
  const settings = board.items.length ? (await getSettings()).settings : null;
  let visible = items;
  if (typeof params.requirement === "string" && typeof params.check === "string") {
    const { getListing } = await import("@/lib/queries");
    const checked = await Promise.all(
      board.items.map(async (item) => ({ item, detail: await getListing(item.id) })),
    );
    visible = checked
      .filter(
        ({ detail }) =>
          (detail?.filters?.results.find((r) => r.filter === params.requirement)?.status ??
            "unknown") === params.check,
      )
      .map(({ item }) => item);
  }
  const newToday = board.items.filter(
    (item) => item.firstSeen.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length;
  const map = params.view === "map" && settings ? await getMapPoints() : null;
  return (
    <ViewShell>
      <h1>
        <span className="sr-only">Apartment Finder. </span>
        {board.counts.pass} places pass. {newToday} new today.
      </h1>
      <p className="mt-2 text-muted-foreground">
        {settings
          ? `Under ${money(settings.budgetCapCents)} all-in, move in ${settings.moveInEarliest} to ${settings.moveInLatest}, ${settings.maxCommuteMinutes} min to work.`
          : "Seed the database to get started."}{" "}
        <Link href="/settings">Edit</Link>
      </p>
      <div className="mt-6 flex flex-wrap gap-x-6">
        <Link href="/requirements">Requirements</Link>
        <Link href="/?status=shortlisted">Shortlist</Link>
        <Link
          href={`/compare?ids=${visible
            .slice(0, 3)
            .map((item) => item.id)
            .join(",")}`}
        >
          Compare
        </Link>
        {status && <Link href="/">All listings</Link>}
      </div>
      <nav
        aria-label="Buckets"
        className="mt-4 flex flex-wrap items-center gap-x-6 border-b border-line"
      >
        {(
          [
            ["pass", "Passes"],
            ["likely", "Likely"],
            ["needs_info", "Needs info"],
            ["fail", "Fails"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/?bucket=${key}${status ? "&status=shortlisted" : ""}`}
            aria-current={key === bucket ? "page" : undefined}
            className={key === bucket ? "border-b-2 border-ink" : "text-muted-foreground"}
          >
            {label} {board.counts[key]}
          </Link>
        ))}
        <Link
          href={`/?bucket=${bucket}${status ? "&status=shortlisted" : ""}${map ? "" : "&view=map"}`}
        >
          {map ? "List" : "Map"}
        </Link>
      </nav>
      {map ? (
        <ListingMap items={visible} points={map} />
      ) : (
        <ul aria-label="Listings">
          {visible.map((item) => (
            <ListingCard key={item.id} item={item} />
          ))}
        </ul>
      )}
      {!visible.length && <p className="py-6 text-muted-foreground">No listings in this view.</p>}
      <p className="mt-5 text-sm text-muted-foreground">
        {bucket !== "fail"
          ? `${board.counts.fail} hidden: ${[...new Set(board.items.filter((item) => item.bucket === "fail").map((item) => item.failReason ?? "Requirements not met"))].join("; ")}.`
          : "Showing listings that fail requirements."}
      </p>
    </ViewShell>
  );
}
