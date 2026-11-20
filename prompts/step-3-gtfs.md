You are doing step 3 (rush-hour frequency job) of the Apartment Finder, on branch step-3-gtfs in this worktree. Read AGENTS.md, TASKS.md, the last PROGRESS.md entries, docs/design.md, and src/db/schema.ts (the `transit_stops` table) first. Give a short plan before editing.

## Goal
An offline job that downloads GTFS transit timetables, computes how often each stop is served at weekday rush hour, and writes the result to `transit_stops`. Plus small pure helpers the app uses later. GTFS reference: https://gtfs.org/schedule/reference/

## You own
`scripts/gtfs/`, `src/lib/transit/`, `tests/transit/`, and writes to the `transit_stops` table only. Do not edit `src/db/` or `src/lib/providers/`.

## Build
1. `scripts/gtfs/download.ts`: download the 511 Bay Area regional feed (`http://api.511.org/transit/datafeeds?api_key=$API_511_TOKEN&operator_id=RG`, check 511's docs for the current URL) and Stanford Marguerite (`https://transportation-forms.stanford.edu/google/google_transit.zip`) into a git-ignored `data/gtfs/` folder. Skip a download if the file is less than 7 days old. Downloading here is allowed by AGENTS.md rule 5's GTFS exception.
2. `scripts/gtfs/compute.ts`: stream-parse stops, trips, stop_times, calendar and calendar_dates (the files are large; do not load stop_times fully into memory). Pick a representative weekday in mid January 2027 that the feed's calendar covers; if the feed does not reach that far, use the next Tuesday the feed does cover and log which date was used. For each stop, count departures between 07:00 and 09:00 and compute the median gap in minutes. Record modes (rail, bus, light rail, shuttle) from routes.txt.
3. Upsert results into `transit_stops` (feed, stop_id, name, lat, lng, modes, weekday_rush_departures, median_rush_headway_min, computed_at).
4. `src/lib/transit/`: pure functions only: `nearestStops(lat, lng, radiusMeters, stops)` using haversine distance, and `serviceQuality(stop)` returning a 0 to 1 value where every 10 minutes or better is 1 and every 30 minutes or worse is 0.
5. `npm run gtfs` runs download then compute and prints a summary, including the rush-hour departures and median gap for the California Ave Caltrain station and the Palo Alto Transit Center.

## Tests
A tiny hand-written GTFS fixture in `tests/fixtures/gtfs/` (2 stops, 3 trips, one calendar exception) with expected counts and headways; tests for `nearestStops` and `serviceQuality`. No network in tests.

## Done when
`npm run check` passes; I run `npm run gtfs` and it prints both stations' numbers; you commit on step-3-gtfs, append to PROGRESS.md, and flip step 3 with evidence. No em dashes in comments or docs.
