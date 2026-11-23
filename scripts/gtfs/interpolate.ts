type StopTime = {
  sequence: number;
  arrival: number | null;
  departure: number | null;
  distance: number | null;
};

/** Input is ordered by stop_sequence. Unbounded gaps remain unknown. */
export function interpolate(stops: StopTime[]): (number | null)[] {
  const times = stops.map((stop) => stop.departure ?? stop.arrival);
  let left = -1;
  for (let right = 0; right < stops.length; right++) {
    if (times[right] === null) continue;
    if (left >= 0 && right > left + 1) {
      const first = stops[left]!;
      const last = stops[right]!;
      const start = first.departure ?? first.arrival!;
      const end = last.arrival ?? last.departure!;
      const segment = stops.slice(left, right + 1);
      const useDistance =
        first.distance !== null &&
        last.distance !== null &&
        last.distance > first.distance &&
        segment.every(
          (stop, index) =>
            stop.distance !== null &&
            (index === 0 || stop.distance >= segment[index - 1]!.distance!),
        );
      if (end >= start && last.sequence > first.sequence) {
        for (let index = left + 1; index < right; index++) {
          const stop = stops[index]!;
          const fraction = useDistance
            ? (stop.distance! - first.distance!) / (last.distance! - first.distance!)
            : (stop.sequence - first.sequence) / (last.sequence - first.sequence);
          times[index] = Math.round(start + fraction * (end - start));
        }
      }
    }
    left = right;
  }
  return times;
}
