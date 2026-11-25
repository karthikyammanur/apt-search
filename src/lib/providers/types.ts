import { z } from "zod";

export const coordinates = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof coordinates>;
export const modeSchema = z.enum(["TRANSIT", "WALK", "BICYCLE"]);
export type Mode = z.infer<typeof modeSchema>;
export const routeInput = z
  .object({
    from: coordinates,
    to: coordinates,
    mode: modeSchema,
    arriveBy: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => v.mode !== "TRANSIT" || v.arriveBy !== undefined);
/** Where a transit step boards or gets off, when the provider says. Any part may be null (Unknown). */
export type StopPoint = { stopId: string | null; lat: number | null; lng: number | null };
export type Route = {
  minutes: number;
  steps: {
    mode: string;
    lineName: string | null;
    minutes: number | null;
    /** Transit steps only, when the provider names them. Absent or null means Unknown. */
    agencyName?: string | null;
    /** Where I board and get off, such as "Palo Alto Caltrain" (needed for Caltrain zones). */
    departureStop?: string | null;
    arrivalStop?: string | null;
    /** Ids and coordinates of those stops, used to find the nearest station in the stop table. */
    departurePoint?: StopPoint | null;
    arrivalPoint?: StopPoint | null;
  }[];
  /**
   * Other itineraries the planner returned that are within ROUTE_CHOICE_WINDOW_MINUTES of this, the
   * fastest one. They let the caller prefer the one with the cheaper pass. Absent when there are none.
   */
  alternatives?: Route[];
};
/** Itineraries within this many minutes of the fastest are treated as equally good ways to commute. */
export const ROUTE_CHOICE_WINDOW_MINUTES = 5;
export const seconds = z.number().finite().nonnegative();
export const duration = z.string().regex(/^\d+(\.\d+)?s$/);
export const minutes = (seconds: number) => Math.ceil(seconds / 60);
export const areaInput = z.object({
  center: coordinates,
  radiusMeters: z.number().positive().max(50_000),
});
