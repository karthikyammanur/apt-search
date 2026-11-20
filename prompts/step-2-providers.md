You are doing step 2 (API clients with caching) of the Apartment Finder, on branch step-2-providers in this worktree. Read AGENTS.md, TASKS.md, the last PROGRESS.md entries, docs/design.md ("Free API stack", "California scope", "Facebook groups") and src/db/schema.ts first. Give a short plan before editing.

## Goal
Typed, cached, rate-limited clients for every external API the app uses, so later steps never call the network directly. Build no business logic (no costs, scores or listing parsing).

## You own
`src/lib/providers/` (including `gmail.ts`), `tests/providers/`, `tests/fixtures/providers/`, `scripts/smoke.ts`, and the `smoke` script line in package.json. Nothing else.

## Build
1. A shared core: `cachedFetch(provider, request, ttl)` that hashes the request, reads and writes `api_cache`, applies a per-provider rate limit, retries once on 5xx, and returns `{ ok: true, data } | { ok: false, error }` with typed errors (rate_limited, quota_paused, not_found, network, bad_response). Validate every response with Zod.
2. Clients (check each provider's current official docs for exact endpoints and field names; do not guess):
   - Google Maps Demo Key (`GOOGLE_MAPS_DEMO_KEY`): Routes API computeRoutes for TRANSIT with an arrival time, plus WALK and BICYCLE; Places API (New) Nearby Search for grocery stores, gyms and cafes (name, location, types; ratings if returned); Geocoding. Treat a daily-limit response as `quota_paused`.
   - TravelTime (`TRAVELTIME_APP_ID`, `TRAVELTIME_API_KEY`): public transport journey time with arrival time.
   - Transitland (`TRANSITLAND_API_KEY`): routing with arrive-by.
   - Geoapify (`GEOAPIFY_API_KEY`): geocoding.
   - openrouteservice (`ORS_API_KEY`): walking and cycling directions and matrix.
   - Overpass (no key): one area query for grocery, gym and cafe POIs; set a descriptive User-Agent.
   - SUPost (no key): public listings API, filtered to housing rooms, shares and sublets; read the OpenAPI spec at https://supost.com/api/public/openapi.json.
   - RentCast (`RENTCAST_API_KEY`, may be blank): long-term rental listings by radius. If the key is blank, return `{ ok: false, error: 'disabled' }`.
   - HUD Fair Market Rent (`HUD_API_TOKEN`): FMR by county or ZIP.
   - Gmail (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`): read-only. Exchange the refresh token, list message IDs under the label `housing-alerts` since a given time, and fetch one message's plain-text and HTML body plus headers. No send, modify, trash or label-change calls may exist in the code.
3. Fallback helpers: `getTransitCommute(from, to, arriveBy)` tries Google, then TravelTime, then Transitland, and reports which provider answered. `geocode(address)` tries Google, then Geoapify. Each returns minutes plus route steps (mode, line name, minutes).
4. Tests use recorded fixtures only (record them once with the smoke script, then strip keys). Cover: cache hit, cache expiry, quota_paused triggers fallback, bad response fails Zod, disabled RentCast.
5. `scripts/smoke.ts`: one live call per provider, using the office address from `config/settings.example.json` (never the local file), printing a one-line result each. It must clearly print whether the Google Demo Key returned a TRANSIT route.

## Constraints
- Rules in AGENTS.md apply, especially: fetch only in `src/lib/providers/`, never fetch Zillow, Craigslist, Airbnb, Furnished Finder, Zumper or Facebook, never read `.env*` files yourself (the app loads them).
- No em dashes in comments or docs.

## Done when
`npm run check` passes with no live calls; I run `npm run smoke` and every provider prints a result (or a clear disabled/error line); you commit on step-2-providers, append to PROGRESS.md, and flip step 2 with evidence. Report which providers worked live and whether the Demo Key supports transit.
