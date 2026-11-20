import { z } from "zod";
import { cachedFetch, failure, mapped, query, TTL, type ClientOptions } from "./core";
import { minutes, routeInput, seconds, type Coordinates, type Route } from "./types";

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
          }),
        ),
      }),
    ),
  }),
});
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
              maxItineraries: 1,
              useFallbackDates: false,
            }),
            init: { headers: { apikey: key } },
            schema: transitlandSchema,
          },
          TTL.route,
        ),
        (data): Route | undefined => {
          const itinerary = data.plan.itineraries[0];
          return (
            itinerary && {
              minutes: minutes(itinerary.duration),
              steps: itinerary.legs.map((leg) => ({
                mode: leg.mode,
                minutes: minutes(leg.duration),
                lineName: leg.routeShortName ?? leg.routeLongName ?? null,
              })),
            }
          );
        },
      );
    },
  };
}
export const transitland = createTransitland();
