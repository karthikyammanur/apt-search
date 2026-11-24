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
  }[];
};
export const seconds = z.number().finite().nonnegative();
export const duration = z.string().regex(/^\d+(\.\d+)?s$/);
export const minutes = (seconds: number) => Math.ceil(seconds / 60);
export const areaInput = z.object({
  center: coordinates,
  radiusMeters: z.number().positive().max(50_000),
});
