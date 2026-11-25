import { z } from "zod";
import {
  cachedFetch,
  failure,
  mapped,
  query,
  TTL,
  type ClientOptions,
  type ProviderError,
} from "./core";
import {
  areaInput,
  duration,
  minutes,
  ROUTE_CHOICE_WINDOW_MINUTES,
  routeInput,
  type Coordinates,
  type Mode,
  type Route,
} from "./types";

const location = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const googleRoutesSchema = z.object({
  routes: z
    .array(
      z.object({
        duration,
        legs: z.array(
          z.object({
            steps: z.array(
              z.object({
                staticDuration: duration.optional(),
                travelMode: z.string(),
                transitDetails: z
                  .object({
                    transitLine: z.object({
                      name: z.string().optional(),
                      nameShort: z.string().optional(),
                      agencies: z.array(z.object({ name: z.string().optional() })).optional(),
                    }),
                    stopDetails: z
                      .object({
                        departureStop: z.object({ name: z.string().optional() }).optional(),
                        arrivalStop: z.object({ name: z.string().optional() }).optional(),
                      })
                      .optional(),
                  })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});
export const googleGeocodeSchema = z.object({
  results: z.array(z.object({ location, formattedAddress: z.string() })),
});
export const googlePlacesSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }),
        location,
        types: z.array(z.string()),
        rating: z.number().min(0).max(5).optional(),
      }),
    )
    .optional(),
});
export function googleError(body: unknown, status: number): ProviderError | undefined {
  const error = z
    .object({ error: z.object({ status: z.string().optional(), message: z.string().optional() }) })
    .safeParse(body);
  if (!error.success) return undefined;
  const message = error.data.error.message ?? "";
  if (/daily|per.day|quota.*exceed|exceed.*quota/i.test(message)) return "quota_paused";
  if (status === 429 || error.data.error.status === "RESOURCE_EXHAUSTED") return "rate_limited";
  return "bad_response";
}
export function createGoogle(options: ClientOptions = {}) {
  const transport = options.transport ?? cachedFetch;
  const key = () => (options.key ?? process.env.GOOGLE_MAPS_DEMO_KEY ?? "").trim();
  return {
    route(from: Coordinates, to: Coordinates, mode: Mode, arriveBy?: string) {
      if (!key()) return Promise.resolve(failure("disabled"));
      const input = routeInput.safeParse({ from, to, mode, arriveBy });
      if (!input.success) return Promise.resolve(failure("bad_response"));
      const waypoint = (p: Coordinates) => ({
        location: { latLng: { latitude: p.lat, longitude: p.lng } },
      });
      return mapped(
        transport(
          "google",
          {
            url: "https://routes.googleapis.com/directions/v2:computeRoutes",
            init: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": key(),
                "X-Goog-FieldMask":
                  "routes.duration,routes.legs.steps.staticDuration,routes.legs.steps.travelMode,routes.legs.steps.transitDetails.transitLine,routes.legs.steps.transitDetails.stopDetails",
              },
              body: JSON.stringify({
                origin: waypoint(from),
                destination: waypoint(to),
                travelMode: mode,
                ...(mode === "TRANSIT" ? { arrivalTime: arriveBy } : {}),
              }),
            },
            schema: googleRoutesSchema,
            classify: googleError,
          },
          TTL.route,
        ),
        (data): Route | undefined => {
          const toRoute = (route: NonNullable<typeof data.routes>[number]): Route => ({
            minutes: minutes(parseFloat(route.duration)),
            steps: route.legs.flatMap((leg) =>
              leg.steps.map((step) => {
                const details = step.transitDetails;
                return {
                  mode: step.travelMode,
                  lineName: details?.transitLine.nameShort ?? details?.transitLine.name ?? null,
                  minutes:
                    step.staticDuration === undefined
                      ? null
                      : minutes(parseFloat(step.staticDuration)),
                  ...(details
                    ? {
                        agencyName: details.transitLine.agencies?.[0]?.name ?? null,
                        departureStop: details.stopDetails?.departureStop?.name ?? null,
                        arrivalStop: details.stopDetails?.arrivalStop?.name ?? null,
                      }
                    : {}),
                };
              }),
            ),
          });
          // The first route is the one Google recommends. Any others within a few minutes of it ride along.
          const [first, ...rest] = (data.routes ?? []).map(toRoute);
          if (!first) return undefined;
          const near = rest.filter((r) => Math.abs(r.minutes - first.minutes) <= ROUTE_CHOICE_WINDOW_MINUTES);
          return near.length > 0 ? { ...first, alternatives: near } : first;
        },
      );
    },
    geocode(address: string) {
      if (!key()) return Promise.resolve(failure("disabled"));
      if (!z.string().trim().min(1).max(500).safeParse(address).success)
        return Promise.resolve(failure("bad_response"));
      return mapped(
        transport(
          "google",
          {
            url: `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}`,
            init: { headers: { "X-Goog-Api-Key": key() } },
            schema: googleGeocodeSchema,
            classify: googleError,
          },
          TTL.geocode,
        ),
        (data) => {
          const first = data.results[0];
          return (
            first && {
              lat: first.location.latitude,
              lng: first.location.longitude,
              address: first.formattedAddress,
            }
          );
        },
      );
    },
    nearby(center: Coordinates, radiusMeters = 1500) {
      if (!key()) return Promise.resolve(failure("disabled"));
      if (!areaInput.safeParse({ center, radiusMeters }).success)
        return Promise.resolve(failure("bad_response"));
      return mapped(
        transport(
          "google",
          {
            url: query("https://places.googleapis.com/v1/places:searchNearby", {}),
            init: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": key(),
                "X-Goog-FieldMask":
                  "places.id,places.displayName,places.location,places.types,places.rating",
              },
              body: JSON.stringify({
                includedTypes: ["grocery_store", "gym", "cafe"],
                locationRestriction: {
                  circle: {
                    center: { latitude: center.lat, longitude: center.lng },
                    radius: radiusMeters,
                  },
                },
              }),
            },
            schema: googlePlacesSchema,
            classify: googleError,
          },
          TTL.pois,
        ),
        (data) =>
          (data.places ?? []).map((p) => ({
            id: p.id,
            name: p.displayName.text,
            lat: p.location.latitude,
            lng: p.location.longitude,
            types: p.types,
            rating: p.rating ?? null,
          })),
      );
    },
  };
}
export const google = createGoogle();
