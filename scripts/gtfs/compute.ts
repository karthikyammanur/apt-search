import path from "node:path";
import { z } from "zod";
import { rows } from "./csv";
import { interpolate } from "./interpolate";

const id = z.string().min(1);
const date = z
  .string()
  .regex(/^\d{8}$/)
  .refine((s) => {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === iso;
  }, "Invalid GTFS date");
const flag = z.enum(["0", "1"]);
const calendarSchema = z.object({
  service_id: id,
  start_date: date,
  end_date: date,
  monday: flag,
  tuesday: flag,
  wednesday: flag,
  thursday: flag,
  friday: flag,
  saturday: flag,
  sunday: flag,
});
const exceptionSchema = z.object({ service_id: id, date, exception_type: z.enum(["1", "2"]) });
type Calendar = z.infer<typeof calendarSchema>;
type Exception = z.infer<typeof exceptionSchema>;
const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const asDate = (s: string) =>
  new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
const compact = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

export function activeServices(
  day: string,
  calendars: Calendar[],
  exceptions: Exception[],
): Set<string> {
  const weekday = weekdays[asDate(day).getUTCDay()]!;
  const services = new Set(
    calendars
      .filter((c) => c.start_date <= day && c.end_date >= day && c[weekday] === "1")
      .map((c) => c.service_id),
  );
  for (const e of exceptions)
    if (e.date === day) {
      if (e.exception_type === "1") services.add(e.service_id);
      else services.delete(e.service_id);
    }
  return services;
}

export function chooseDate(
  calendars: Calendar[],
  exceptions: Exception[],
  today = new Date(),
): string {
  for (const day of ["20270112", "20270113", "20270114", "20270115", "20270111"]) {
    if (activeServices(day, calendars, exceptions).size) return day;
  }
  const bounds = [...calendars.map((c) => c.end_date), ...exceptions.map((e) => e.date)].sort();
  const end = bounds.at(-1);
  if (!end) throw new Error("Feed has no calendar coverage");
  const cursor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  cursor.setUTCDate(cursor.getUTCDate() + ((2 - cursor.getUTCDay() + 7) % 7 || 7));
  for (; compact(cursor) <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const candidate = compact(cursor);
    if (activeServices(candidate, calendars, exceptions).size) return candidate;
  }
  throw new Error("Feed covers neither mid January 2027 nor a future Tuesday; refresh the feed");
}

/** "service_date": counted on the chosen date. "current_schedule": the agency's calendar ends
 * before that date, so the same weekday in its last covered week was counted instead. */
export type ScheduleBasis = "service_date" | "current_schedule";
export const CURRENT_SCHEDULE_LABEL = "based on current schedule";

export type AgencyDate = {
  agencyId: string;
  name: string;
  /** YYYYMMDD the agency's trips were counted on. */
  day: string;
  /** Last YYYYMMDD the agency's calendar covers, or null when it has no calendar rows. */
  coverageEnd: string | null;
  basis: ScheduleBasis;
};

/**
 * The date to count one agency's trips on. An agency whose calendar ends before the target
 * (a feed that has not published that period yet) falls back to the same weekday in the last
 * week it covers, stepping back a week at a time past holidays with no service.
 */
export function agencyServiceDate(
  target: string,
  serviceIds: ReadonlySet<string>,
  calendars: Calendar[],
  exceptions: Exception[],
): { day: string; coverageEnd: string | null; basis: ScheduleBasis } {
  const own = calendars.filter((c) => serviceIds.has(c.service_id));
  const ownExceptions = exceptions.filter((e) => serviceIds.has(e.service_id));
  const ends = [
    ...own.map((c) => c.end_date),
    ...ownExceptions.filter((e) => e.exception_type === "1").map((e) => e.date),
  ].sort();
  const end = ends.at(-1) ?? null;
  if (end === null || end >= target) return { day: target, coverageEnd: end, basis: "service_date" };
  const cursor = asDate(end);
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() - asDate(target).getUTCDay() + 7) % 7));
  for (let week = 0; week < 8; week++, cursor.setUTCDate(cursor.getUTCDate() - 7)) {
    const candidate = compact(cursor);
    if (activeServices(candidate, own, ownExceptions).size)
      return { day: candidate, coverageEnd: end, basis: "current_schedule" };
  }
  return { day: target, coverageEnd: end, basis: "service_date" };
}

export type StopResult = {
  feed: string;
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  modes: string[];
  weekdayRushDepartures: number;
  medianRushHeadwayMin: number | null;
  computedAt: string;
  /** Not stored: transit_stops has no column for it. Printed by the job. */
  scheduleBasis: ScheduleBasis;
};
const timeSchema = z
  .string()
  .regex(/^\d{2,}:\d{2}:\d{2}$/)
  .refine((s) => {
    const parts = s.split(":").map(Number);
    return parts[1]! < 60 && parts[2]! < 60;
  });
const seconds = (s: string) =>
  s
    .split(":")
    .map(Number)
    .reduce((a, b) => a * 60 + b, 0);
const median = (times: number[]): number | null => {
  if (times.length < 2) return null;
  times.sort((a, b) => a - b);
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return Math.round(
    (gaps.length % 2 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2) / 60,
  );
};

export async function compute(
  directory: string,
  feed: string,
  today = new Date(),
): Promise<{
  date: string;
  agencies: AgencyDate[];
  stops: StopResult[];
  missingTimes: number;
  interpolatedTimes: number;
  before: StopResult[];
}> {
  const file = (name: string) => path.join(directory, `${name}.txt`);
  const calendars: Calendar[] = [],
    exceptions: Exception[] = [];
  for await (const row of rows(file("calendar"), calendarSchema, true)) calendars.push(row);
  for await (const row of rows(file("calendar_dates"), exceptionSchema, true)) exceptions.push(row);
  const day = chooseDate(calendars, exceptions, today);
  const agencyNames = new Map<string, string>();
  for await (const a of rows(
    file("agency"),
    z.object({ agency_id: z.string().default(""), agency_name: z.string().default("") }),
    true,
  ))
    agencyNames.set(a.agency_id, a.agency_name);
  const routes = new Map<string, { mode: string; agency: string }>();
  for await (const r of rows(
    file("routes"),
    z.object({
      route_id: id,
      route_type: z.coerce.number().int().nonnegative(),
      agency_id: z.string().default(""),
    }),
  )) {
    const type = r.route_type;
    const mode =
      feed === "marguerite"
        ? "shuttle"
        : type === 0 || (type >= 900 && type < 1000)
          ? "light rail"
          : [1, 2, 5, 6, 7, 12].includes(type) ||
              (type >= 100 && type < 200) ||
              (type >= 400 && type < 500)
            ? "rail"
            : type === 3 ||
                type === 11 ||
                (type >= 200 && type < 300) ||
                (type >= 700 && type < 900)
              ? "bus"
              : null;
    if (mode) routes.set(r.route_id, { mode, agency: r.agency_id });
  }
  const allTrips: { tripId: string; mode: string; agency: string; serviceId: string }[] = [];
  const agencyServiceIds = new Map<string, Set<string>>();
  for await (const t of rows(
    file("trips"),
    z.object({ trip_id: id, route_id: id, service_id: id }),
  )) {
    const route = routes.get(t.route_id);
    if (!route) continue;
    allTrips.push({ tripId: t.trip_id, mode: route.mode, agency: route.agency, serviceId: t.service_id });
    const ids = agencyServiceIds.get(route.agency) ?? new Set<string>();
    ids.add(t.service_id);
    agencyServiceIds.set(route.agency, ids);
  }
  // Each agency is counted on the chosen date, or on its own fallback date (see agencyServiceDate).
  const agencies: AgencyDate[] = [];
  const agencyActive = new Map<string, { services: Set<string>; basis: ScheduleBasis }>();
  for (const [agencyId, ids] of [...agencyServiceIds].sort(([a], [b]) => a.localeCompare(b))) {
    const chosen = agencyServiceDate(day, ids, calendars, exceptions);
    agencies.push({ agencyId, name: agencyNames.get(agencyId) || agencyId, ...chosen });
    agencyActive.set(agencyId, {
      services: activeServices(chosen.day, calendars, exceptions),
      basis: chosen.basis,
    });
  }
  const trips = new Map<string, string>();
  const fallbackTrips = new Set<string>();
  for (const t of allTrips) {
    const active = agencyActive.get(t.agency)!;
    if (!active.services.has(t.serviceId)) continue;
    trips.set(t.tripId, t.mode);
    if (active.basis === "current_schedule") fallbackTrips.add(t.tripId);
  }
  const frequencies = new Map<string, { start: number; end: number; gap: number }[]>();
  for await (const f of rows(
    file("frequencies"),
    z.object({
      trip_id: id,
      start_time: timeSchema,
      end_time: timeSchema,
      headway_secs: z.coerce.number().int().positive(),
    }),
    true,
  )) {
    if (!trips.has(f.trip_id)) continue;
    const start = seconds(f.start_time),
      end = seconds(f.end_time);
    if (end <= start) throw new Error("Invalid frequency interval");
    const entries = frequencies.get(f.trip_id) ?? [];
    entries.push({ start, end, gap: f.headway_secs });
    frequencies.set(f.trip_id, entries);
  }
  const timeRow = z.object({
    trip_id: id,
    stop_id: id,
    stop_sequence: z.coerce.number().int().nonnegative(),
    departure_time: z.union([timeSchema, z.literal("")]).default(""),
    arrival_time: z.union([timeSchema, z.literal("")]).default(""),
    shape_dist_traveled: z.union([z.literal(""), z.coerce.number().nonnegative()]).default(""),
    pickup_type: z.enum(["", "0", "1", "2", "3"]).default(""),
  });
  const tripTimes = new Map<string, z.infer<typeof timeRow>[]>();
  for await (const t of rows(file("stop_times"), timeRow)) {
    if (!trips.has(t.trip_id)) continue;
    const entries = tripTimes.get(t.trip_id) ?? [];
    entries.push(t);
    tripTimes.set(t.trip_id, entries);
  }
  const stops = new Map<
    string,
    {
      result: StopResult;
      parent: string;
      times: number[];
      beforeTimes: number[];
      modes: Set<string>;
      fallback: boolean;
    }
  >();
  for await (const s of rows(
    file("stops"),
    z.object({
      stop_id: id,
      stop_name: z.string().default(""),
      stop_lat: z.string().default(""),
      stop_lon: z.string().default(""),
      parent_station: z.string().default(""),
      location_type: z.string().default(""),
    }),
  )) {
    if (s.location_type && !["0", "1"].includes(s.location_type)) continue;
    const coordinate = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    });
    if (!s.stop_lat || !s.stop_lon) throw new Error("Stop missing coordinates");
    const coords = coordinate.parse({ lat: s.stop_lat, lng: s.stop_lon });
    stops.set(s.stop_id, {
      result: {
        feed,
        stopId: s.stop_id,
        name: id.parse(s.stop_name),
        ...coords,
        modes: [],
        weekdayRushDepartures: 0,
        medianRushHeadwayMin: null,
        computedAt: today.toISOString(),
        scheduleBasis: "service_date",
      },
      parent: s.parent_station,
      times: [],
      beforeTimes: [],
      modes: new Set(),
      fallback: false,
    });
  }
  let missingTimes = 0,
    interpolatedTimes = 0;
  for (const [tripId, entries] of tripTimes) {
    entries.sort((a, b) => a.stop_sequence - b.stop_sequence);
    const departures = interpolate(
      entries.map((t) => ({
        sequence: t.stop_sequence,
        arrival: t.arrival_time ? seconds(t.arrival_time) : null,
        departure: t.departure_time ? seconds(t.departure_time) : null,
        distance: t.shape_dist_traveled === "" ? null : t.shape_dist_traveled,
      })),
    );
    const base = departures[0];
    const oldBase = entries.find((t) => t.departure_time);
    const expand = (departure: number, startTime: number | null | undefined): number[] => {
      const windows = frequencies.get(tripId);
      if (!windows) return departure >= 7 * 3600 && departure < 9 * 3600 ? [departure] : [];
      if (startTime == null) throw new Error("Frequency trip missing start time");
      const times: number[] = [];
      const offset = departure - startTime;
      for (const window of windows) {
        const first = Math.max(0, Math.ceil((7 * 3600 - offset - window.start) / window.gap));
        for (
          let start = window.start + first * window.gap;
          start < window.end && start + offset < 9 * 3600;
          start += window.gap
        ) {
          times.push(start + offset);
        }
      }
      return times;
    };
    for (const [index, t] of entries.entries()) {
      if (t.pickup_type === "1") continue;
      const stop = stops.get(t.stop_id);
      if (!stop) throw new Error("Trip references missing stop");
      stop.modes.add(trips.get(tripId)!);
      if (t.departure_time)
        stop.beforeTimes.push(
          ...expand(seconds(t.departure_time), oldBase ? seconds(oldBase.departure_time) : null),
        );
      const departure = departures[index];
      if (departure == null) {
        missingTimes++;
        continue;
      }
      if (!t.departure_time && !t.arrival_time) interpolatedTimes++;
      const counted = expand(departure, base);
      if (counted.length && fallbackTrips.has(tripId)) stop.fallback = true;
      stop.times.push(...counted);
    }
  }
  // Station records aggregate their platforms; platform records retain their own service.
  for (const stop of stops.values())
    if (stop.parent) {
      const parent = stops.get(stop.parent);
      if (parent) {
        parent.times.push(...stop.times);
        parent.beforeTimes.push(...stop.beforeTimes);
        if (stop.fallback) parent.fallback = true;
        for (const mode of stop.modes) parent.modes.add(mode);
      }
    }
  return {
    date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
    agencies,
    missingTimes,
    interpolatedTimes,
    before: [...stops.values()].map((s) => ({
      ...s.result,
      modes: [...s.modes].sort(),
      weekdayRushDepartures: s.beforeTimes.length,
      medianRushHeadwayMin: median(s.beforeTimes),
    })),
    stops: [...stops.values()].map((s) => ({
      ...s.result,
      scheduleBasis: s.fallback ? ("current_schedule" as const) : ("service_date" as const),
      modes: [...s.modes].sort(),
      weekdayRushDepartures: s.times.length,
      medianRushHeadwayMin: median(s.times),
    })),
  };
}
