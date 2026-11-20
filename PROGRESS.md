# Progress log

Append one entry per session. Newest at the bottom.

<!--
## YYYY-MM-DD, step N, agent name
- Changed: what and where
- Commands run (with output): `npm run check` ...
- Assumptions:
- Open risks or questions for Karthik:
-->

## 2026-11-19, step 1, Claude Code

Branch `step-1-harness`, implementation commit `99ecd4e`.

### Changed
- Next.js 16.4.6 app (App Router, Turbopack), TypeScript strict with `noUncheckedIndexedAccess`, Tailwind 4, `shadcn init` only (no components added), ESLint 9, Prettier. The scaffold was generated in a scratch directory and copied in selectively so it could not overwrite `AGENTS.md`, `CLAUDE.md` or `.gitignore`.
- `src/db/`: `schema.ts` (all 9 tables from docs/design.md plus `photos`), generated migration `0000_regular_ultimo.sql`, `index.ts` (libSQL client), `settings-schema.ts` (one Zod schema), `settings.ts` (Zod on read and write), `defaults.ts` (8 soft factors, starting weight 0.125), `seeding.ts` and `seed.ts`, `run-migrations.ts` and `migrate.ts`.
- Password gate: `src/proxy.ts` (Next 16 name for middleware, TASKS.md row updated to match), `src/app/login/{page,login-form,actions,session}`. HMAC-SHA256 signed cookie, httpOnly, sameSite lax, secure in production, 30 days, key derived from `APP_PASSWORD`. Fails closed when `APP_PASSWORD` is unset. `/api/*` gets 401, everything else redirects to `/login`.
- Tests: `tests/guards/` (5 guards from the prompt, plus provenance and seed tests, plus session token tests), `tests/e2e/login.spec.ts`.
- Harness: `.husky/pre-commit` runs `npm run check`; `.nvmrc` (22.14); `engines.node` `>=22.12`; `.gitignore` extended; SETUP.md has one Turso line.
- Placeholder READMEs (one line each) in the other steps' folders, as the step 1 prompt asked. New files only; nothing existing was edited.
- Outside the literal Owns list but needed for the scaffold: `src/app/{layout,page,globals.css,favicon.ico}`, `src/lib/utils.ts` (shadcn `cn` re-export), `components.json`, `vitest.config.mts`, `playwright.config.ts`, `drizzle.config.ts`, `.prettierrc`, `.prettierignore`.
- `npm run smoke` is an inline `node -e` in package.json that prints "no providers yet". `scripts/smoke.ts` belongs to step 2, which will replace the script.

### Packages added
- Runtime: `next`, `react`, `react-dom` (app); `drizzle-orm`, `@libsql/client` (database); `zod` (validation); `cn`, `tw-animate-css`, `shadcn` (what `shadcn init` wires into `src/lib/utils.ts` and `globals.css`; `cn` is published by the shadcn maintainers as the clsx plus tailwind-merge replacement).
- Dev: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/turbopack` (from the Next scaffold); `eslint`, `eslint-config-next`; `prettier`; `drizzle-kit` (generates migrations); `tsx` (runs the TypeScript seed and migrate scripts); `vitest`; `@playwright/test`; `husky`.
- `shadcn init` also installed `@base-ui/react`, `class-variance-authority` and `lucide-react` for a Button component. I deleted the Button (`src/components/` is step 7's folder) and uninstalled those three.
- Playwright also downloaded a Chromium build (not an npm package).

### Commands run (with output)
Baseline before any change: `npm run check` printed `npm error Missing script: "check"` (no package.json existed; expected for step 1).

Node: `node -v` printed `v26.13.1`, not 22.14. That satisfies `engines` (`>=22.12`) and the latest Vitest and Vite, so everything below ran on Node 26.13.1. It was not run on 22.14 (see risks).

```
$ npm run check
> tsc --noEmit && eslint . && vitest run
 Test Files  7 passed (7)
      Tests  34 passed | 1 skipped (35)
(exit 0)

$ npm run build
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully
Route (app)
┌ ○ /
├ ○ /_not-found
└ ○ /login
ƒ Proxy (Middleware)
(exit 0)

$ npm run test:e2e
Running 1 test using 1 worker
  ok 1 [chromium] › tests\e2e\login.spec.ts:4:1 › wrong password is rejected, right password reaches the home page (929ms)
  1 passed (14.4s)
(exit 0)
```

The 1 skipped test is the tool registry guard, which skips while `src/lib/agent/tools.ts` does not exist.

Fresh clone (`git clone`, then `npm ci`, with no `.env*`, no `data/`, no `next-env.d.ts`):
```
$ npm run db:migrate && npm run db:seed
Migrations applied.
Seeded from settings.example.json: 11 settings, 8 starting weights written.
(exit 0)
```
`npm run check` and `npm run build` also passed in that clone. Seeding a second time wrote 0 rows (idempotent). Weights in the table sum to 1.

Guard demonstrations. For each, I added a deliberate violation under `src/`, ran the guard, removed the file, and ran it again.
```
GUARD 1  src/lib/intake/violation.ts:  export const load = () => fetch("https://example.com/data");
  FAIL  "src/lib/intake/violation.ts: calls fetch outside src/lib/providers/"     (1 failed | 1 passed)
  after removal:  Tests 2 passed (2)

GUARD 2a src/lib/intake/violation.ts:  fetch("https://www.facebook.com/groups/12345")
  FAIL  "src/lib/intake/violation.ts: fetch call mentions a banned site"           (1 failed | 9 passed)
GUARD 2b src/lib/providers/violation.ts:  const BASE = "https://www.zillow.com/homes/"; fetch(BASE)
  guard 1 passes there (providers may fetch); guard 2:
  FAIL  "src/lib/providers/violation.ts: provider file references a banned site host"  (1 failed | 9 passed)
  after removal:  Tests 10 passed (10)

GUARD 3  src/app/violation.tsx:  "use client"; export const key = process.env.APP_PASSWORD;
  FAIL  "src/app/violation.tsx: \"use client\" file reads process.env"             (1 failed | 1 passed)
  after removal:  Tests 2 passed (2)

GUARD 4  src/lib/agent/tools.ts exporting toolRegistry with get_shortlist and send_message
  before the file existed:  Tests 1 passed | 1 skipped (2)
  FAIL  "tool \"send_message\" contains a forbidden word (send, email, reply, pay, purchase)"
  clean registry (get_shortlist, record_feedback):  Tests 2 passed (2), executed, not skipped
  after removal:  Tests 1 passed | 1 skipped (2)

GUARD 5  src/lib/intake/violation.ts:  scopes include .../auth/gmail.readonly and .../auth/gmail.send
  FAIL  "src/lib/intake/violation.ts: Gmail scope \"gmail.send\" is not gmail.readonly"  (1 failed | 7 passed)
  after removal:  Tests 8 passed (8)

Clean tree, full suite:  Test Files 7 passed (7), Tests 34 passed | 1 skipped (35)
```

Pre-commit hook: with the guard 1 violation staged, `git commit` printed the failing guard, then `husky - pre-commit script failed (code 1)`; exit status 1; HEAD stayed at `99ecd4e`. I then unstaged and deleted the violation file.

### Assumptions
- Settings are a key/value table (JSON value) so later steps can add settings without a migration; Zod validates every read and write. `npm run db:seed` keeps existing rows; `npm run db:seed -- --overwrite` re-reads settings from the config file. Learned weights are never overwritten.
- Seeded weights are `preferences` rows with kind `soft`, value null, weight 0.125, and `set_by` null (a starting default neither of us has touched). The design lists `set_by` as me or chat only; null is my addition.
- Soft factor keys (my naming): `commute`, `transit_quality`, `budget_headroom`, `grocery`, `gym`, `cafes`, `reviews_trust`, `lease_fit`. They come from the 8 rows of the Scoring table in docs/design.md and are exported from `src/db/defaults.ts` for step 4.
- `facts` has a unique index on (listing_id, field): one current value per field. `enrichment` is keyed by `listing_id`. `api_cache` is keyed by (provider, request_hash). `chat.role` is limited to user, assistant, system, tool.
- Tool registry contract for step 6: `src/lib/agent/tools.ts` exports `toolRegistry`, an object keyed by tool name or an array of objects with `name`.
- The guards scan raw text including comments, so a comment under `src/` must not contain a call to fetch, a banned domain, or a non-readonly Gmail scope. Providers may mention sender addresses such as `@mail.craigslist.org`; those are not flagged. Banned list also covers `fb.com` and `fb.me`.
- The DB scripts do not read `.env.local`; they default to `file:data/dev.db`. Next itself loads `.env*` files at build and run time; I did not open any of them.
- E2E runs a production build on port 3100 with its own throwaway password (`tests/e2e/env.ts`).

### Open risks or questions for Karthik
- Node: I could not test on 22.14. The terminal had v26.13.1, and a probe to fetch a 22.14 binary was blocked. Please run `npm run check` once under 22.14 (for example with nvm) before relying on `.nvmrc`.
- `npm audit` reports 4 moderate findings, all dev-only: `drizzle-kit` depends on the deprecated `@esbuild-kit` packages, which pull in an old esbuild (GHSA-67mh-4wv8-2f99, about esbuild's dev server, which we never run). The offered fix downgrades `drizzle-kit`, so I did not apply it.
- Next prints a warning that it ignored a stray `package-lock.json` in the Downloads folder above the repo. Deleting that file removes the warning; or set `turbopack.root` in `next.config.ts`.
- The scaffold turned on `cacheComponents` and `partialPrefetching` in `next.config.ts`. I kept them. They require pages that read cookies, headers or the database to sit inside a Suspense boundary, which step 6 and step 7 will run into. Easy to turn off if that is unwanted friction.
- No rate limiting on the login form. Fine behind a long password; worth adding if the app is public.
- Schema gaps the design text implies but its column lists do not include: Facebook `group_name` and `poster_profile_url`, a list of merged source links for dedupe, and a photo hash. I followed the listed columns exactly. Steps 5 and 7 cannot edit `src/db/`; they can store these as `facts` rows, or ask for a schema change.
- By hand: import the repo into Vercel, set `APP_PASSWORD`, `DATABASE_URL` and `DATABASE_AUTH_TOKEN` there, then run `db:migrate` and `db:seed` against Turso with shell variables (see SETUP.md). I did not do any of this.

## 2026-11-19, step 1b, Claude Code

Small fixes to step 1 before steps 2 to 4 start. Branch `step-1-harness`, commit `48dc43e`. Step 1 stays Passing; no status was changed.

### Changed
- **Schema**, migration `0001_overrated_captain_marvel.sql` (incremental, so an existing database upgrades in place):
  - `listings` gains `post_type` (room_offered, whole_place_offered, roommate_wanted, unknown; default unknown), `group_name`, `poster_profile_url` and `source_links` (JSON array of `{source, url, seen_at}`, default `[]`). `src/db/source-links.ts` has the Zod schema for it.
  - `photos` gains `phash` (nullable).
  - New tables `roommate_leads`, `channel_runs`, `transit_stops` (primary key `feed, stop_id`) and `login_attempts`. 14 tables in total.
- **Facts**: the unique index is now (`listing_id`, `field`, `provenance`). `src/db/facts.ts` exports `PROVENANCE_PRIORITY` (landlord, me, listing, api, estimate) and the pure `pickCurrentFact(rows)`, which returns the winning row.
- **`next.config.ts`**: `cacheComponents` and `partialPrefetching` removed. The build no longer prints "Cache Components enabled".
- **Login rate limit**: 5 failed attempts within 15 minutes lock that client out for 15 minutes. `src/db/login-attempts.ts` holds the gate, `src/app/login/attempt-login.ts` holds the whole login decision (free of Next APIs so tests can call it), and `actions.ts` is now thin.
- **`.claude/settings.json`**: explicit `Read` denies for `.env`, `.env.local`, `.env.development`, `.env.test`, `.env.staging`, `.env.production` and `.env.*.local`.
- **Fetch guard** now scans `src/` and `scripts/`, and allows `fetch` in `src/lib/providers/` and `scripts/gtfs/`. The banned-site checks still apply in both. AGENTS.md rule 5 has the one-line GTFS exception.
- **TASKS.md** (ownership only): step 2 lists `src/lib/providers/gmail.ts`; step 3 notes it writes only to `transit_stops`; a line under the table says only step 1 edits `src/db/`.
- **E2E**: `playwright.config.ts` now deletes and migrates a throwaway `data/e2e.db` before the build, and sets `DATABASE_URL` to it, because the login page now needs a database. Added a second e2e test that checks the lockout through the real request path.
- New tests: `facts.test.ts`, `login-rate-limit.test.ts`, `tables.test.ts`; `fetch-boundary.test.ts` and `banned-domains.test.ts` extended.

### Commands run (with output)
Baseline before any change: `npm run check` passed (34 passed, 1 skipped). Node was v26.13.1.

```
$ npm run check
 Test Files  10 passed (10)
      Tests  65 passed | 1 skipped (66)
(exit 0)

$ npm run build
✓ Compiled successfully
Route (app)  ┌ ○ /   ├ ○ /_not-found   └ ○ /login      ƒ Proxy (Middleware)
(exit 0)

$ npm run test:e2e
  ok 1 › wrong password is rejected, right password reaches the home page (754ms)
  ok 2 › login rate limit › five wrong passwords lock the client out, even for the right password (709ms)
  2 passed (11.6s)
(exit 0)
```

Fresh clone of commit `48dc43e` (`npm ci`, no `.env*`, no `data/`):
```
$ npm run db:migrate && npm run db:seed
Migrations applied.
Seeded from settings.example.json: 11 settings, 8 starting weights written.
tables: 14 | migrations: 2
```
`npm run check` (65 passed, 1 skipped) and `npm run test:e2e` (2 passed) also passed in that clone.

In-place upgrade of the existing step 1 database (`data/dev.db`, created under migration 0000): `npm run db:migrate` took it from 1 to 2 migrations, kept all 11 settings and the 8 weights (sum 1), added the 5 new tables and columns, and left a second run a no-op.

Rate limit test check: I temporarily set `LOGIN_MAX_FAILURES` to 6. 5 unit tests and the e2e lockout test failed, so they do detect the limit. I reverted it; the figures above are from the reverted tree.

Fetch guard exception, each with a deliberate file that I removed afterward:
```
scripts/violation.ts          fetch("https://example.com/data")
  FAIL  "scripts/violation.ts: calls fetch outside src/lib/providers/ and scripts/gtfs/"
scripts/gtfs/download.ts      fetch("https://api.511.org/transit/datafeeds?operator_id=CT")
  PASS  both fetch guards (14 passed)
scripts/gtfs/download.ts      fetch("https://www.zillow.com/feed.zip")
  boundary guard PASS; banned-domain guard FAIL:
    "scripts/gtfs/download.ts: fetch call mentions a banned site"
    "scripts/gtfs/download.ts: fetching code references a banned site host"
```
`.claude/settings.json` parses, and `.env.example` is still readable (I read its first 3 lines).

### Assumptions
- The rate limit is per client, keyed on the first address in `x-forwarded-for` (falling back to `x-real-ip`, then `unknown`). A single global counter would let anyone lock the owner out. On Vercel the platform sets that header; anywhere else a caller could vary it, so only trust it behind a proxy you control.
- The lock lasts 15 minutes from the fifth failure. Rejected attempts during a lockout are not recorded, so it cannot extend itself. A correct login clears that client's failures, and rows older than 24 hours are pruned. If the database errors, login fails closed with "Login is temporarily unavailable".
- `pickCurrentFact` skips rows whose value is null (null means unknown), so an unknown never overrides a known value from a lower source. It returns null if no row has a known value, and breaks a same-source tie by latest `checked_at`.
- `listings.post_type` is NOT NULL with default `unknown`. `channel_runs.items_seen` and `items_new` are NOT NULL with no default. `transit_stops.weekday_rush_departures` is NOT NULL (0 is a real count) and `median_rush_headway_min` is nullable.
- I added no unique constraint on `roommate_leads.post_url`, so step 5 has to dedupe repeat captures in code.
- The `.env` deny list uses explicit names, not `Read(./.env.*)`, because deny rules win over allow rules and a wildcard would also block `.env.example`.
- The fetch guard does not scan `extension/`, because the browser extension has to POST captures to the app.

### Open risks or questions for Karthik
- Login now depends on the database. On a first Vercel deploy, run `db:migrate` against Turso first, or the login page shows "Login is temporarily unavailable".
- AGENTS.md's folder map still says providers is "the ONLY place allowed to call `fetch`". Rule 5 now states the GTFS exception, but you may want the folder map wording to match. I left it, since you asked for one line.
- I did not test the new deny rules: that would mean trying to read a file I am told never to read. I am also not sure they cover shell commands such as `cat`.
- A `.env.local` now exists; Next loads it at build and run time and I have not opened it. The e2e overrides `APP_PASSWORD` and `DATABASE_URL`, so it cannot reach whatever database that file names.
- The risks from the step 1 entry still stand: Node 22.14 is untested, 4 dev-only `npm audit` findings via `drizzle-kit`, and the stray `package-lock.json` in the Downloads folder.

## 2026-11-20, step 3, Codex

Branch: `step-3-gtfs`. Implementation and offline verification complete. Step 3 stays Failing because live station-number evidence is still pending. No status was flipped without evidence.

### Changed
- Added the offline GTFS runner, seven-day ZIP cache, streaming ZIP extraction and streaming CSV parsing. Downloads use the documented 511 regional endpoint over HTTPS and the supplied Marguerite endpoint. Calendar dates and exceptions select a covered mid-January 2027 weekday, or the next covered future Tuesday, with the selected date logged.
- Counts departures in [07:00, 09:00), computes median gaps rounded to integer minutes, aggregates parent stations, records supported modes and upserts only `transit_stops` in feed transactions. Handles frequency templates at nominal headways and warns about missing departure times.
- Added pure haversine nearest-stop and service-quality helpers, a hand-written two-stop/three-trip fixture with one calendar exception, and offline tests for CSV chunk boundaries, exceptions, rush boundaries, missing times, frequency expansion, cache reuse, ZIP extraction and repeat upserts.
- Root changes approved by the user: only the `gtfs` script and `fflate` dependency in package.json, the corresponding lockfile entries, and one `data/gtfs/` ignore line. No provider or database source files changed.
- Added dependency: `fflate` 0.8.3, for portable streaming ZIP decompression. CSV parsing adds no dependency. npm reported 8 moderate audit findings; no unrelated dependency upgrades were made.

### Commands and output
Node: `v22.14.0`.

The initial `npm run check` invocation was blocked by PowerShell's unsigned npm.ps1 policy. Using npm.cmd runs the same script successfully.

Baseline, before edits:
```
$ npm.cmd run check
 Test Files  10 passed (10)
      Tests  65 passed | 1 skipped (66)
(exit 0)
```

Final:
```
$ npm.cmd run check
 Test Files  12 passed (12)
      Tests  80 passed | 1 skipped (81)
(exit 0)

$ npm.cmd run gtfs
> tsx scripts/gtfs/run.ts
Set API_511_TOKEN in the shell environment
(exit 1)

$ git diff --check
(no whitespace errors; line-ending notices only)
(exit 0)
```

### Assumptions and open risks
- No .env files or private local settings were opened. API_511_TOKEN is absent from the shell. To finish acceptance, run `npm run gtfs` with that variable supplied and a migrated database, then append both stations' actual numbers and flip only step 3 to Passing. Live feeds, credentials, station-name matching and production feed size remain unverified.
- Combined platform/direction gaps measure aggregate stop service, not service in a particular commute direction. Simultaneous departures count separately. Missing times stay omitted with a warning; fewer than two departures yields a null headway. Frequency-based service with exact_times=0 uses nominal intervals.
- Only rail, light rail, bus and Marguerite shuttle are included. Unknown or other modes are excluded. Stops with missing coordinates fail validation rather than acquiring invented locations. Expired feeds with no future covered Tuesday fail explicitly.
- Downloads follow the current 511 documentation: https://511.org/open-data/transit . GTFS interpretation follows https://gtfs.org/documentation/schedule/reference/ . Extracted temporary files are removed after each feed. No live calls were made and no application data was written during verification.

## 2026-11-20, step 3 live verification, Codex

The user explicitly authorized loading `.env.local` for this run without displaying its contents. Loaded it through Node's `--env-file` flag. No secrets or private configuration values were printed or committed. Geoapify is not used by this step.

### Changed
- Tightened station summary matching after the first live run incorrectly labeled the unrelated stop `On Clark Way @ Vi At Palo Alto` as Palo Alto Transit Center. Added a regression test and support for the `Transit Ctr` spelling.
- Step 3 is now Passing based on the fixture checks and live evidence below. Only step 3's status changed in TASKS.md.

### Commands and evidence
The initial network attempt was blocked by the sandbox. Retried with approved network access. Both official ZIPs downloaded and validated successfully. The corrected verification below reused the seven-day cache with no further downloads.

```
$ node --env-file=.env.local --import tsx scripts/gtfs/run.ts
511: using ZIP cached less than 7 days ago
511: service date 2027-01-12; weekday 07:00 inclusive to 09:00 exclusive; 20407 stops
511: WARNING 6105 active stop times lack departure times and were omitted
California Ave Caltrain: 511/california_ave California Avenue: 12 rush-hour departures; median gap 10 min; modes rail
California Ave Caltrain: 511/70191 California Avenue Caltrain Station Northbound: 6 rush-hour departures; median gap 15 min; modes rail
California Ave Caltrain: 511/70192 California Avenue Caltrain Station Southbound: 6 rush-hour departures; median gap 15 min; modes rail
Palo Alto Transit Center: 511/mtc:palo-alto-station Palo Alto Station: 16 rush-hour departures; median gap 4 min; modes rail
Palo Alto Transit Center: 511/70172 Palo Alto Caltrain Station Southbound: 8 rush-hour departures; median gap 15 min; modes rail
Palo Alto Transit Center: 511/70171 Palo Alto Caltrain Station Northbound: 8 rush-hour departures; median gap 15 min; modes rail
marguerite: using ZIP cached less than 7 days ago
marguerite: service date 2027-01-12; weekday 07:00 inclusive to 09:00 exclusive; 185 stops
(exit 0; selected station output shown)

$ npm.cmd run check
 Test Files  12 passed (12)
      Tests  81 passed | 1 skipped (82)
(exit 0)

$ git diff --check
(no whitespace errors; line-ending notices only)
(exit 0)
```

The `gtfs` npm script invokes the same `tsx scripts/gtfs/run.ts` entrypoint. The Node command above additionally loads the user-authorized local environment without changing package.json or permanent environment-loading behavior. Both feeds were upserted successfully, writing only `transit_stops`.

### Remaining limitations
- The 511 feed has 6,105 active records without departure times. These are omitted with a warning, so affected stop counts can be incomplete.
- The station summaries above are combined rail-platform service. The separately printed bus-bay records have zero counted departures and Unknown median gaps on the selected date. Those results do not establish future bus availability outside the supplied service calendars. The Marguerite feed uses other stop names and contributes no matching station-summary records.
- The previous entry's missing-token and unverified-live-run blockers are resolved. No dependencies were added in this follow-up.

## 2026-11-20, step 4, Claude Code

Cost model, hard filters, scoring, feedback, explanations and the Bay Area region pack. Branch `step-4-domain`, commit `b4cc303`. Files only under `src/lib/domain/`, `src/lib/regions/` and `tests/domain/`.

### Changed
- **`src/lib/domain/`** (pure, no I/O):
  - `types.ts`: `ListingFacts`, where every field is `Fact<T> | null` (value plus provenance; null is Unknown), and `unknownListing()`. `Settings` is the existing type from `src/db/settings-schema.ts`, so it matches `config/settings.example.json` by construction.
  - `rational.ts`: exact BigInt fractions. Money stays exact through every sum and division and is rounded once, half up, to whole cents.
  - `stay.ts`, `lease.ts`: months of stay = days / 30.4375 (exactly days * 16 / 487); one lease analysis shared by the lease filter, the break-fee line and the lease fit score.
  - `cost.ts`: `computeCost(facts, settings, regionPack)` returns lines (Confirmed, Estimated or Unknown, each with source, URL, as-of date and a question), `allInMonthlyCents`, `allInPlusTransitCents`, `upfrontCashCents`, `passesOnEstimatesOnly`, plus `confirmedFloorCents` and `estimatedFloorCents`.
  - `filters.ts`: one function per dealbreaker (`checkBudget`, `checkMoveIn`, `checkLease`, `checkCommute`, `checkTransitAccess`, `checkPrivateBedBath`, `checkFurnished`, `checkScamChecks`, `checkRoommates`), and `runHardFilters`, which gives a pass, fail or needs_info bucket with deduplicated questions.
  - `score.ts`: the 8 curves from the design table, `normalizeWeights`, `scoreListing` (0 to 100). `feedback.ts`: `applyFeedback`, plus a Zod `feedbackChangeSchema` for step 6's tool arguments. `explain.ts`: top two strengths and the biggest weakness.
- **`src/lib/regions/`**: `bay-area.ts` (every number has a source URL and an as-of date), `index.ts` (`getRegionPack`; any other region gets a pack that answers Unknown), `types.ts`.

### Region pack figures (all estimates, checked 2026-11-20)
| Item | Value | Source | Check |
| --- | --- | --- | --- |
| Caltrain monthly, 1 zone / 2 zones | $96 / $150 | caltrain.com/fares | Read on the fare chart |
| Caltrain zones | Redwood City 2; Menlo Park, Palo Alto, California Ave, San Antonio, Mountain View, Sunnyvale 3 | caltrain.com/fares | Read on the schedule tables |
| VTA monthly | $90 | vta.gov/fares | Not verified: the page failed to load (expired certificate). Value from the step prompt |
| SamTrans monthly | $65.60 | samtrans.com/fares | Read |
| Stanford Marguerite | free | transportation.stanford.edu | From the design doc |
| Utilities | FY2026 median household bill: Palo Alto $426, Menlo Park $530, Redwood City $541, Mountain View $457; other cities use $541 | City of Palo Alto Utilities bill insert, June 2026 | Read in the PDF |
| Utilities, one person's share | household bill / household size when known (2 or more), else / 2.55 | Census QuickFacts, Palo Alto, 2019 to 2023 | From search results; census.gov refused the direct fetch (403) |
| Internet | $45 | cabletv.com, Palo Alto | From search results |
| Renter's insurance | $15 | NerdWallet, California | From search results |

### Commands run (with output)
Baseline before any change:
```
$ npm run check
 Test Files  10 passed (10)
      Tests  65 passed | 1 skipped (66)
```
After:
```
$ npx vitest run tests/domain
 Test Files  5 passed (5)
      Tests  184 passed (184)

$ npm run check
 Test Files  15 passed (15)
      Tests  249 passed | 1 skipped (250)
(exit 0; the pre-commit hook ran it again on commit b4cc303 with the same result)
```
The "Done when" cases, by test:
- $2,500 boundary (`cost.test.ts`, "$2,500 boundary"): $2,500.00 passes and $2,500.01 fails; the same pair through end rounding ($2,499.995 rounds to $2,500.00 and passes, $2,500.005 rounds to $2,500.01 and fails).
- Unknown to Needs info: "Unknown rent gives an Unknown total and a Needs info result with the rent question".
- Transit-fits bonus (`score.test.ts`, "budget headroom and the transit-fits bonus"): $2,404 plus a $96 pass scores 1; $2,450 plus $96 scores 0.52; housing at $2,500 scores 0; the bonus moves the total score by the expected 6.0 points.
- Also covered: utilities included vs stated vs estimated, a one-time fee spread over the stay, a 12-month lease with a break fee (spread, and pushing a listing over the cap), the feedback cap, clamps and renormalization, and explanation choices.

Mutation checks (each reverted right after; the numbers above are from the reverted tree):
```
cap check changed from <= to <        Tests  2 failed | 182 passed (184)
round half up replaced by floor       Tests  13 failed | 171 passed (184)
headroom ignores the transit pass     Tests  3 failed | 181 passed (184)
```

### Assumptions
- **Strict Unknowns.** Rent, short-term premium, mandatory monthly fees, one-time fees, the non-refundable deposit, setup items and (for a lease that may run long) the break fee have no region estimate. If any is null, the total is Unknown and the listing goes to Needs info with the landlord question. Most listings will land in Needs info until intake (step 5) records "no fees" as a listing fact with value 0, or the landlord answers. This follows "never default a missing value to 0", but you will notice it.
- **The cap check uses floors.** Fail when confirmed lines alone exceed the cap, since Unknown and estimated lines are at least 0. If only estimates push it over, the result is Unknown (Needs info), not Fail, so a guess never hides a good place. A pass that includes any estimated line sets `passesOnEstimatesOnly` and names the lines: "Passes on estimates, confirm utilities with landlord."
- **Confirmed vs Estimated** comes from provenance: `estimate` is Estimated; `listing`, `landlord`, `me` and `api` are Confirmed.
- **Stay:** move-in is the later of the listing's available date and my earliest move-in. If the available date is Unknown, the latest move-in is used (fewer months gives a higher monthly share of one-time costs, so the check errs safe).
- **Lease:** a fixed lease fits if its length is the stay rounded down to rounded up (7 to 8 months by default, recomputed when dates change); a sublet must run to move-out; month-to-month fits; a longer lease needs a written break or sublet clause. A sublet clause scores lease fit 0.5 and adds no cost (the risk of paying rent until a subtenant is found is not modeled). A free break clause scores 0.5 and a paid one 0.
- **Upfront cash** = refundable deposit + the first full month's rent, premium and mandatory fees + one-time fees + non-refundable deposit. No proration; setup purchases and the break fee are left out.
- **Inferences:** a studio or whole apartment counts as a private bedroom and bath with no roommates, unless a fact says otherwise; a room is treated as having roommates.
- **Transit access** passes if any stop within a 10 min walk runs every 30 min or better (defaults in `TRANSIT_ACCESS_DEFAULTS`, since the settings schema has no fields for them).
- **Score:** an Unknown factor earns no points and keeps a null score; `knownWeight` shows how much of the weight rests on known facts. Curve endpoints are fixed to the design table (commute 15 to 30 min, not tied to `maxCommuteMinutes`). Choices the table leaves open: transit quality is the best stop's average of walk (5 to 10 min) and frequency (15 to 30 min; regional rail counts as frequent). Cafes: each cafe counts 1 within 10 min, sliding to 0 at 15, and 3 give full marks. Reviews and trust = rating (3.5 to 4.5 stars) times recent volume (5 reviews in 2 years for full) times the share of scam checks passed; any failed check gives 0.
- **Feedback:** input weights are normalized first; changes to one factor add up, then cap at plus or minus 0.1; each weight clamps to 0..1; then all renormalize. The log shows two decimals ("Raised transit quality from 0.13 to 0.17") and one line when the other weights were rescaled.
- **Explanations:** strength = points earned (weight times score), weakness = points lost; Unknown factors are listed apart; ties go to the earlier factor.
- **Transit pass:** per agency, the cheapest product covering that agency's legs; Caltrain uses the zone span. No cross-agency discounts are modeled.

### Open risks or questions for Karthik
- **The Caltrain 2-zone pass may rise to $156 on 2027-01-01**, inside the stay. Caltrain's proposed-fares page (caltrain.com/node/11802) lists a +$0.25 zone upgrade on 1/1/27, and passes cost 24 one-way fares. I could not confirm it was adopted, so the pack uses $150. It only affects Redwood City commutes; 1 zone stays $96.
- **VTA $90 is unverified** (vta.gov had an expired certificate when checked).
- **The utilities estimate for one person is rough.** It is a median household bill divided by 2.55, which probably undercounts a studio (fixed sewer and refuse charges) and may overcount a small room share. The bills exclude taxes and fees, and Palo Alto proposed an 8% increase from 2026-07-01. These lines are labeled Estimated and trigger the "confirm with landlord" flag.
- Sunnyvale and East Palo Alto have no bill figure in the source; they use the highest bill in the table ($541).
- Settings has no fields for the transit-access thresholds (10 min, 30 min), so they are domain constants for now. Making them editable needs a step 1 schema change.
- `computeCost` expects integer cents. A non-integer amount throws a RangeError instead of producing a wrong number, so step 5 should validate facts with Zod before calling it.
