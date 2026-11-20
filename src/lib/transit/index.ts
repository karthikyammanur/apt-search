export interface TransitStop {
  lat: number;
  lng: number;
  medianRushHeadwayMin: number | null;
}

/** Stops within the inclusive radius, ordered by distance in meters. */
export function nearestStops<T extends { lat: number; lng: number }>(
  lat: number,
  lng: number,
  radiusMeters: number,
  stops: readonly T[],
): (T & { distanceMeters: number })[] {
  if (
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lng) ||
    Math.abs(lng) > 180 ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters < 0
  ) {
    throw new RangeError("Invalid coordinates or radius");
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  return stops
    .map((stop) => {
      const a =
        Math.sin(radians(stop.lat - lat) / 2) ** 2 +
        Math.cos(radians(lat)) *
          Math.cos(radians(stop.lat)) *
          Math.sin(radians(stop.lng - lng) / 2) ** 2;
      return { ...stop, distanceMeters: 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) };
    })
    .filter((stop) => stop.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** Unknown headways cannot earn a service bonus. */
export function serviceQuality(stop: Pick<TransitStop, "medianRushHeadwayMin">): number {
  const gap = stop.medianRushHeadwayMin;
  return gap === null || !Number.isFinite(gap) || gap < 0
    ? 0
    : Math.max(0, Math.min(1, (30 - gap) / 20));
}
