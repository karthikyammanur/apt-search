Run `npm run gtfs` with `API_511_TOKEN` set in the shell. This job never reads
`.env` files. Set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in the shell when using
Turso; otherwise it writes to the migrated local `data/dev.db`.

ZIPs are cached for seven days under ignored `data/gtfs/`. Downloads use HTTPS,
are validated before replacing the cache, and credentials are omitted from errors.
Only `transit_stops` is written. No migrations run automatically.

The service date is a covered weekday near January 12, 2027, or the next covered
Tuesday after the run date. Expired feeds fail with a refresh instruction. The
selected date is logged separately for each feed.

Rush hour is [07:00, 09:00) in the feed's local service-day time. Departures after
24:00 belong to that service day, so they are outside this window. Calendar
exceptions override weekly service. No-pickup events are excluded. Missing times
are omitted with a warning. Frequency trips are expanded at their advertised
headway; these represent nominal departures when exact_times is 0.

Headways are the median of consecutive departure gaps, rounded to integer minutes.
Simultaneous departures remain separate events. Fewer than two departures gives
Unknown. Stations aggregate platform events, and each platform also retains its
own result. These combined-direction figures are service indicators, not a
direction-specific commute guarantee. Rail, light rail, bus and Marguerite
shuttle services are included; other route modes are excluded.

Parsing and ZIP extraction use bounded chunks. Only stops, routes, active trips,
calendars and rush-hour events are retained. stop_times is streamed, with a second
pass only for frequency-template offsets. `fflate` is the sole added dependency,
for portable streaming ZIP decompression; CSV parsing uses Node streams.

Sources: [511 feed endpoint](https://511.org/open-data/transit),
[GTFS schedule reference](https://gtfs.org/documentation/schedule/reference/).
