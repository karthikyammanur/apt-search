import { z } from "zod";
import { cachedFetch, failure, mapped, query, TTL, type ClientOptions } from "./core";
import { minutes, ROUTE_CHOICE_WINDOW_MINUTES, routeInput, seconds, type Coordinates, type Route, type StopPoint } from "./types";

const place = z
  .object({
    name: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
    stopId: z.string().optional(),
  })
  .optional();
export const transitlandSchema = z.object({
  plan: z.object({
    itineraries: z.array(
      z.object({
        duration: seconds,
        legs: z.array(
          z.object({
            mode: z.string(),
            duration: seconds,
            routeShortName: z.string().optional(),
            routeLongName: z.string().optional(),
            agencyName: z.string().optional(),
            from: place,
            to: place,
          }),
        ),
      }),
    ),
  }),
});
type Leg = z.infer<typeof transitlandSchema>["plan"]["itineraries"][number]["legs"][number];

/** The planner labels legs by vehicle (BUS, RAIL, TRAM...). The app's steps say WALK, BICYCLE or TRANSIT. */
function stepMode(mode: string): string {
  const upper = mode.toUpperCase();
  return upper === "WALK" || upper === "BICYCLE" ? upper : "TRANSIT";
}
const stopPoint = (p: NonNullable<Leg["from"]> | undefined): StopPoint | null =>
  p && (p.stopId !== undefined || p.lat !== undefined)
    ? { stopId: p.stopId ?? null, lat: p.lat ?? null, lng: p.lon ?? null }
    : null;
const nonEmpty = (text: string | undefined) => (text ? text : null);

export function createTransitland(options: ClientOptions = {}) {
  const transport = options.transport ?? cachedFetch;
  return {
    route(from: Coordinates, to: Coordinates, arriveBy: string) {
      const key = (options.key ?? process.env.TRANSITLAND_API_KEY ?? "").trim();
      if (!key) return Promise.resolve(failure("disabled"));
      if (!routeInput.safeParse({ from, to, mode: "TRANSIT", arriveBy }).success)
        return Promise.resolve(failure("bad_response"));
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Los_Angeles",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(arriveBy))
          .map((p) => [p.type, p.value]),
      );
      return mapped(
        transport(
          "transitland",
          {
            url: query("https://transit.land/api/v2/routing/otp/plan", {
              fromPlace: `${from.lat},${from.lng}`,
              toPlace: `${to.lat},${to.lng}`,
              arriveBy: true,
              date: `${parts.year}-${parts.month}-${parts.day}`,
              time: `${parts.hour}:${parts.minute}`,
              maxItineraries: 3,
              useFallbackDates: false,
            }),
            init: { headers: { apikey: key } },
            schema: transitlandSchema,
          },
          TTL.route,
        ),
        (data): Route | undefined => {
          // The planner returns a walk-only itinerary beside the transit ones, and not always in the
          // same order. The commute is the quickest way without a car, so the shortest comes first, and
          // the others within a few minutes of it ride along so the caller can prefer a cheaper pass.
          const routes = data.plan.itineraries
            .map(
              (itinerary): Route => ({
                minutes: minutes(itinerary.duration),
                steps: itinerary.legs.map((leg) => ({
                  mode: stepMode(leg.mode),
                  minutes: minutes(leg.duration),
                  lineName: leg.routeShortName ?? leg.routeLongName ?? null,
                  agencyName: nonEmpty(leg.agencyName),
                  departureStop: nonEmpty(leg.from?.name),
                  arrivalStop: nonEmpty(leg.to?.name),
                  departurePoint: stopPoint(leg.from),
                  arrivalPoint: stopPoint(leg.to),
                })),
              }),
            )
            .sort((a, b) => a.minutes - b.minutes);
          const [fastest, ...others] = routes;
          if (!fastest) return undefined;
          const near = others.filter((r) => r.minutes - fastest.minutes <= ROUTE_CHOICE_WINDOW_MINUTES);
          return near.length > 0 ? { ...fastest, alternatives: near } : fastest;
        },
      );
    },
  };
}
export const transitland = createTransitland();
