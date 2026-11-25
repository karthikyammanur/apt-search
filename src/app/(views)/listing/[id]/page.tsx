import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { draftMessage, draftQuestions, fmtDayRange, tidyText } from "@/lib/domain";
import { getListing, getSettings } from "@/lib/queries";
import { ViewShell, primaryButton } from "@/components/view-shell";
import { CostTable, RequirementsChecklist, money, minutes } from "@/components/listing-values";
import { PhotoGallery } from "@/components/photos";
import { CopyDraft } from "@/components/copy-draft";
import { changeStatus } from "../../actions";
import { requireLogin } from "../../auth";

export default async function Listing({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) notFound();
  const detail = await getListing(id.data);
  if (!detail) notFound();
  const { settings } = await getSettings();
  const fact = (key: string) => detail.facts[key]?.current?.value as string | undefined;
  const failed = detail.bucket === "fail";
  const failReasons = (detail.filters?.results ?? []).filter((r) => r.status === "fail").map((r) => tidyText(r.reason));
  const approximate = detail.facts.locationApproximate?.current?.value === true;
  const approximateNote = detail.facts.locationApproximate?.current?.note ?? "Approximate location";
  const unknownCosts = (detail.cost?.lines ?? [])
    .filter((line) => line.status === "unknown" && line.kind === "recurring")
    .map((line) => line.label);
  const asks = failed ? [] : draftQuestions(detail.filters?.results ?? [], settings, unknownCosts);
  const draft = draftMessage(asks);
  // The facts the commute and the pass came from, so the page says which route they are based on.
  const routedBy = /^Routed by (.+)$/.exec(detail.facts.commuteMinutes?.current?.note ?? "")?.[1] ?? null;
  const route = detail.commute.legs.length
    ? detail.commute.legs
        .filter((leg) => leg.mode !== "walk" || detail.commute.legs.length === 1)
        .map((leg) => `${leg.agency ?? leg.mode}${leg.from ? ` from ${leg.from}` : ""}${leg.to ? ` to ${leg.to}` : ""}`)
        .join(", then ")
    : null;
  const summary = [
    detail.listing.city,
    detail.transit.nearestStop
      ? detail.transit.stopWalkMinutes !== null
        ? `${minutes(detail.transit.stopWalkMinutes)} walk to ${detail.transit.nearestStop}`
        : `Near ${detail.transit.nearestStop}`
      : null,
    fmtDayRange(fact("availableFrom"), fact("leaseEnd")),
    approximate ? "Approximate location" : null,
  ].filter((part): part is string => Boolean(part));
  const forMe = (detail.filters?.questions ?? [])
    .filter((q) => q.ask === "me")
    // The Google Lens check is about the photos, so it only shows when there are some.
    .filter((q) => q.field !== "scam.photos_reused" || detail.photos.length > 0);
  const tiles = [
    [money(detail.allInMonthlyCents), "a month, all-in"],
    [minutes(detail.commute.transitMinutes), approximate ? "to work, approximate location" : "to work by transit"],
    ...(failed ? [] : [[detail.score ?? "Unknown", "fit score"]]),
  ];
  return (
    <ViewShell>
      <Link href="/" className="mb-3 text-sm text-muted-foreground">
        Back to listings
      </Link>
      <PhotoGallery urls={detail.photos.map((p) => p.url)} originalUrl={detail.listing.url} />
      <h1 className="mt-7 !text-listing-title">{detail.listing.title ?? "Untitled listing"}</h1>
      {failed && failReasons.length > 0 && (
        <p className="mt-2 font-medium text-attention">Fails: {failReasons.join("; ")}</p>
      )}
      {summary.length > 0 && <p className="mt-2 text-muted-foreground">{summary.join(" · ")}</p>}
      {approximate && (
        <p className="mt-1 text-sm text-muted-foreground">{tidyText(approximateNote)}. Confirm the address before relying on the commute.</p>
      )}
      <div className={`mt-7 grid gap-3 ${tiles.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {tiles.map(([value, label]) => (
          <div key={label}>
            <div className={`text-xl font-semibold sm:text-2xl ${label === "fit score" ? "text-primary" : ""}`}>{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <RequirementsChecklist detail={detail} />
      <section>
        <h2>Cost</h2>
        <CostTable detail={detail} />
      </section>
      <section>
        <h2>Getting to work</h2>
        <p>
          {route ? `Commute and transit pass are based on: ${route}` : "Route: Unknown"}
          {routedBy ? ` (routed by ${routedBy})` : ""}. Or bike: {minutes(detail.commute.bikeMinutes)}.
        </p>
        {detail.facts.commuteRoute?.current?.note && (
          <p className="mt-1 text-sm text-muted-foreground">{tidyText(detail.facts.commuteRoute.current.note)}.</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          Rush-hour service: {minutes(detail.transit.rushHeadwayMinutes)} between departures
          {detail.transit.stops.some((s) => s.scheduleBasis === "current_schedule") ? ", based on current schedule" : ""}.
        </p>
      </section>
      <section>
        <h2>Nearby on foot</h2>
        <p>
          {[
            detail.places?.grocery
              ? `${detail.places.grocery.name}: ${minutes(detail.places.grocery.walkMinutes)}`
              : `Grocery: Unknown${detail.places?.notChecked.includes("grocery_store") ? " (not checked)" : ""}`,
            detail.places?.gym
              ? `${detail.places.gym.name}: ${minutes(detail.places.gym.walkMinutes)}`
              : `Gym: Unknown${detail.places?.notChecked.includes("gym") ? " (not checked)" : ""}`,
            ...(detail.places && detail.places.cafes.length > 0
              ? detail.places.cafes.map((p) => `${p.name}: ${minutes(p.walkMinutes)}`)
              : [`Cafes: ${detail.places?.notChecked.includes("cafe") || !detail.places ? "Unknown (not checked)" : "none found"}`]),
          ].join(" · ")}
        </p>
      </section>
      {!failed && (draft || forMe.length > 0) && (
        <section>
          <h2>Still to ask</h2>
          {draft && <p className="mb-3 text-sm text-muted-foreground">Copy it and send it yourself.</p>}
          {forMe.map((q) => (
            <p key={q.field} className="mb-2 text-attention">
              For you: {tidyText(q.text)}
            </p>
          ))}
          {draft && <CopyDraft text={draft} />}
        </section>
      )}
      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2">
        <form action={changeStatus}>
          <input type="hidden" name="listingId" value={id.data} />
          <input type="hidden" name="status" value={detail.listing.userStatus === "shortlisted" ? "none" : "shortlisted"} />
          <button className={primaryButton}>{detail.listing.userStatus === "shortlisted" ? "Remove from shortlist" : "Shortlist"}</button>
        </form>
        <form action={changeStatus}>
          <input type="hidden" name="listingId" value={id.data} />
          <input type="hidden" name="status" value="rejected" />
          <button>Not for me</button>
        </form>
        <Link href={`/chat?listing=${id.data}`}>Ask in chat</Link>
      </div>
    </ViewShell>
  );
}
