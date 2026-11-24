import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getListing } from "@/lib/queries";
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
  const fact = (key: string) => detail.facts[key]?.current?.value as string | undefined;
  const questions = detail.filters?.questions ?? [];
  const draft = questions.length
    ? `Hi! I'm interested in this listing. ${questions
        .filter((q) => q.ask === "landlord")
        .map((q) => q.text)
        .join(" ")}`
    : "Hi! I'm interested in this listing. Could we arrange a live video tour and confirm the lease terms?";
  return (
    <ViewShell>
      <Link href="/" className="mb-3 text-sm text-muted-foreground">
        Back to listings
      </Link>
      <PhotoGallery urls={detail.photos.map((p) => p.url)} originalUrl={detail.listing.url} />
      <h1 className="mt-7 !text-listing-title">{detail.listing.title ?? "Untitled listing"}</h1>
      <p className="mt-2 text-muted-foreground">
        {detail.listing.city ?? "Unknown"} · {minutes(detail.transit.stopWalkMinutes)} walk to{" "}
        {detail.transit.nearestStop ?? "Unknown stop"} · {fact("availableFrom") ?? "Unknown"} to{" "}
        {fact("leaseEnd") ?? "Unknown"}
      </p>
      <div className="mt-7 grid grid-cols-3 gap-3">
        {[
          [money(detail.allInMonthlyCents), "a month, all-in"],
          [minutes(detail.commute.transitMinutes), "to work by transit"],
          [detail.score ?? "Unknown", "fit score"],
        ].map(([value, label]) => (
          <div key={label}>
            <div
              className={`text-xl font-semibold sm:text-2xl ${label === "fit score" ? "text-primary" : ""}`}
            >
              {value}
            </div>
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
          {detail.commute.legs.length
            ? detail.commute.legs
                .map(
                  (leg) =>
                    `${leg.agency ?? leg.mode}${leg.from ? ` from ${leg.from}` : ""}${leg.to ? ` to ${leg.to}` : ""}`,
                )
                .join(", then ")
            : "Route: Unknown"}
          . Or bike: {minutes(detail.commute.bikeMinutes)}.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Rush-hour service: {minutes(detail.transit.rushHeadwayMinutes)} between departures
          {detail.transit.stops.some((s) => s.scheduleBasis === "current_schedule")
            ? ", based on current schedule"
            : ""}
          .
        </p>
      </section>
      <section>
        <h2>Nearby on foot</h2>
        <p>
          {[
            detail.places?.grocery
              ? `${detail.places.grocery.name}: ${minutes(detail.places.grocery.walkMinutes)}`
              : "Grocery: Unknown",
            detail.places?.gym
              ? `${detail.places.gym.name}: ${minutes(detail.places.gym.walkMinutes)}`
              : "Gym: Unknown",
            ...(detail.places?.cafes.map((p) => `${p.name}: ${minutes(p.walkMinutes)}`) ?? [
              "Cafes: Unknown",
            ]),
          ].join(" · ")}
        </p>
      </section>
      <section>
        <h2>Still to ask</h2>
        <p className="mb-3 text-sm text-muted-foreground">Copy it and send it yourself.</p>
        {questions
          .filter((q) => q.ask === "me")
          .map((q) => (
            <p key={q.field} className="mb-2 text-attention">
              For you: {q.text}
            </p>
          ))}
        <CopyDraft text={draft} />
      </section>
      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2">
        <form action={changeStatus}>
          <input type="hidden" name="listingId" value={id.data} />
          <input
            type="hidden"
            name="status"
            value={detail.listing.userStatus === "shortlisted" ? "none" : "shortlisted"}
          />
          <button className={primaryButton}>
            {detail.listing.userStatus === "shortlisted" ? "Remove from shortlist" : "Shortlist"}
          </button>
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
