# Deploying to Vercel Hobby with Turso

This is the checklist for the first production deploy. Nothing here deploys by itself: every step is one you run. The setup is Vercel Hobby for the app and the daily cron, and Turso for the database.

## 1. Environment variables

Nothing in the code throws at startup for a missing variable. Missing keys turn a feature off (it shows Unknown) or make a route refuse every call. So check this table before the first deploy rather than waiting for an error.

Set these in the Vercel project (Settings, Environment Variables), for Production. Add Preview too if you want preview deployments to work.

| Variable | Read by | Required | Notes |
| --- | --- | --- | --- |
| `APP_PASSWORD` | `src/proxy.ts`, `src/app/login/actions.ts`, `src/app/(views)/auth.ts`, `src/app/chat/actions.ts`, `src/app/api/chat/route.ts` | Yes | The login password. It is also the secret that signs the session cookie, so changing it signs you out. Empty means nobody can log in. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | `src/db/index.ts` | Yes | Created for you by the Turso integration (section 3). Read only on Vercel. |
| `CRON_SECRET` | `src/app/api/cron/intake/route.ts` | Yes | 16 or more characters. Vercel sends it as `Authorization: Bearer <value>`. Without it every cron call returns 401. |
| `CAPTURE_TOKEN` | `src/app/api/capture/route.ts`, `src/lib/intake/capture.ts` | Yes, for the extension | 16 or more characters. The same value goes into the extension's Options page. |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `SAMBANOVA_API_KEY`, `ZAI_API_KEY` | `src/lib/llm/providers.ts` | At least one | The model fallback chain, in that order. Chat needs a provider that supports tools, so set at least one of the first four. `ZAI_API_KEY` is used for intake extraction only. A blank key skips that provider. |
| `TRANSITLAND_API_KEY` | `src/lib/providers/transitland.ts` | Yes, for commute times | Primary transit routing in production. Blank means every transit commute is Unknown. |
| `GEOAPIFY_API_KEY` | `src/lib/providers/geoapify.ts` | Yes, for addresses and walk and bike times | Primary geocoding, walking and biking in production. Blank means Unknown. |
| `RENTCAST_API_KEY` | `src/lib/providers/rentcast.ts` | No | The RentCast channel. Blank skips it. |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | `src/lib/providers/gmail.ts` | No | The Gmail alerts channel, read-only. Set all three or none. |
| `GEMINI_MODEL`, `GEMINI_VISION_MODEL` and the same pairs for `OPENROUTER`, `GROQ`, `SAMBANOVA`, `ZAI` | `src/lib/llm/providers.ts` | No | Model ID overrides. The defaults are in that file. Not listed in `.env.example`. |

Do not set these on Vercel:

- `GOOGLE_MAPS_DEMO_KEY`. Its terms forbid production use. The code never calls Google on Vercel production even if the key is present, but leave it out so there is nothing to misuse.
- `DATABASE_URL` and `DATABASE_AUTH_TOKEN`. They win over the `TURSO_*` pair. If `DATABASE_URL` is a `file:` path on Vercel, the app writes to a temporary disk that is gone on the next cold start.
- `AGENT_FAKE_MODEL`. It is the test-only scripted chat model. It is also disabled whenever `VERCEL` is set.

Set by Vercel itself: `VERCEL`, `VERCEL_ENV` (read by `src/lib/providers/fallbacks.ts`, `src/lib/intake/geo.ts` and `src/db/index.ts`) and `NODE_ENV` (`src/app/login/actions.ts`, the cookie `secure` flag).

Shell only, for the one-time commands in section 4, never in a file: `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `API_511_TOKEN` (`scripts/gtfs/download.ts`).

`.env.example` also lists `OLLAMA_BASE_URL`, `TRAVELTIME_*`, `ORS_API_KEY`, `HUD_API_TOKEN`, `ENABLE_APIFY` and `APIFY_TOKEN`. No code reads them today, so setting them does nothing.

### How the database client picks its database

`src/db/index.ts` (`resolveDatabaseConfig`, tested in `tests/db/database-config.test.ts`):

1. `DATABASE_URL` and `DATABASE_AUTH_TOKEN`, if set. This is what the one-time scripts use.
2. Otherwise, on a Vercel deployment only, `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
3. Otherwise `file:data/dev.db`.

`TURSO_*` is ignored off Vercel on purpose. A `vercel env pull` writes the project's variables into `.env.local`, and without this rule local `npm run dev` would open the production database. If you set `TURSO_DATABASE_URL` in a shell and run `npm run db:migrate`, it prints a warning that the variable was ignored, and it always prints which database it is about to migrate.

## 2. Vercel Hobby limits this app is built around

Read from the Vercel docs on 2026-11-24. Re-check them if you have not deployed for a while.

| Limit | Hobby value | Source |
| --- | --- | --- |
| Function duration, default and maximum | 300 s (5 minutes), with Fluid Compute, which is on by default for new projects | [Configuring maximum duration](https://vercel.com/docs/functions/configuring-functions/duration), [Function limits](https://vercel.com/docs/functions/limitations) |
| A function that runs past its limit | Terminated; the caller sees a 504 `FUNCTION_INVOCATION_TIMEOUT` | [Function limits](https://vercel.com/docs/functions/limitations) |
| Cron jobs per project | 100 | [Cron jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Cron frequency | Once per day at most. An expression that runs more often fails the deployment | same page |
| Cron timing | Within the scheduled hour (up to 59 minutes late), not at the exact minute | same page and [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Cron function limits | Same as any function, including the 300 s duration | [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Cron delivery | Best effort, and a run can occasionally arrive twice | [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |

The docs pages do not give a Hobby limit for projects with Fluid Compute turned off, and do not state the cron time zone. If your project predates Fluid Compute, open Project Settings, Functions and confirm it is on. `vercel.json` schedules `0 14 * * *`, which is daily and fits the Hobby rule; treat the time as 14:00 UTC, give or take the hour.

### How the cron route fits

`src/app/api/cron/intake/route.ts` sets `maxDuration = 300`, the Hobby maximum, and passes `CRON_BUDGET` (`src/lib/intake/run.ts`) to the run:

- At most 12 posts that need real work (a model call) per run, added up across SUPost, Gmail and RentCast, and at most 6 per channel so one busy channel cannot use the whole run. Posts already seen cost almost nothing and do not count.
- No new post is started after 150 s. A channel that has not begun by then, or that finds the 12-post total used up, is skipped and is not recorded as run, so it goes first the next day.
- A post still unfinished at 270 s is given up on, the rest are deferred, and the run records itself and answers, instead of being killed by the platform at 300 s with nothing recorded. That leaves 30 s for the final writes.
- Deferred posts are noted in `channel_runs` and picked up by the next daily run.

A post takes roughly 10 to 20 s (one model call, then geocoding, commute and places). Twelve of them fit well inside 150 s of start time in a normal run. `tests/intake/run-budget.test.ts` checks the caps, the start cutoff, the hard stop, and that the budget stays inside `maxDuration`.

`/api/capture` (the extension) handles one click at a time and also has `maxDuration = 300`.

## 3. Create the database and the project

1. Create a Turso database. Either use the Turso integration from the Vercel Marketplace (Storage, Turso), which creates `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the project ([Turso's Vercel page](https://docs.turso.tech/integrations/vercel), [Marketplace listing](https://vercel.com/marketplace/tursocloud)), or create it yourself in the Turso dashboard and add the two variables by hand.
2. Import the GitHub repository into Vercel. The framework is detected as Next.js. The root directory is the repository root. No build or install command needs changing.
3. Add the variables from section 1. Set `CRON_SECRET` and `CAPTURE_TOKEN` to long random strings.
4. Do not deploy yet. The database is empty, so the first request would fail until section 4 is done.

## 4. One-time commands against Turso (PowerShell)

These run on your machine. The variables exist only in this shell session and are never written to a file. `db:migrate`, `db:seed` and `gtfs` do not read `.env` files, by design.

Get the database URL and a token from the Turso dashboard, or with the Turso CLI (`turso db show <name> --url` and `turso db tokens create <name>`).

```powershell
cd C:\path\to\apt-search

# Typing the token with Read-Host keeps it out of your PowerShell history.
$env:DATABASE_URL = "libsql://<your-database>-<your-org>.turso.io"
$env:DATABASE_AUTH_TOKEN = Read-Host "Turso token"

# 1. Create the tables. It prints the database it is touching first: check the host is your Turso one.
npm run db:migrate

# 2. Write your settings and the starting weights. This reads config\settings.local.json on this
#    machine (your real office and budget), or the example file if that does not exist.
npm run db:seed

# 3. Load the transit stop frequencies (needs a 511.org token).
$env:API_511_TOKEN = Read-Host "511 token"
npm run gtfs

# 4. Clear the variables so nothing stays in the session.
Remove-Item Env:DATABASE_URL, Env:DATABASE_AUTH_TOKEN, Env:API_511_TOKEN
```

Check the output of each step:

- `db:migrate` should print `Migrating libsql://<your-host>` and then `Migrations applied.` If it prints `Migrating file:data/dev.db`, the variable was not set and it is about to touch your local file instead.
- `db:seed` prints how many settings and weights it wrote, never the values.
- `gtfs` prints the weekday 7 to 9 am frequency for the named stations. It writes only the `transit_stops` table.

Never run `npm run db:seed:demo` against Turso. It refuses any remote database, but there is no reason to try.

When you later change the schema, run `npm run db:migrate` the same way before deploying the new code. Migrations do not run on Vercel automatically.

## 5. Deploy and check

1. Deploy from the Vercel dashboard (or push to the production branch).
2. Open the production URL, log in with `APP_PASSWORD`, and confirm the board loads. A `no such column` error means a migration is missing: run `db:migrate` again.
3. Check the cron. In Vercel, open the project's Cron Jobs settings and confirm `/api/cron/intake` is listed. To run it once by hand (this runs the real intake and uses real free quota):

```powershell
$env:CRON_SECRET = Read-Host "Cron secret"
Invoke-RestMethod -Uri "https://<your-app>.vercel.app/api/cron/intake" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
Remove-Item Env:CRON_SECRET
```

   The reply lists each channel with `seen`, `new`, `deferred` and any `error`. A 401 means `CRON_SECRET` is missing, shorter than 16 characters, or different from the one in the project.
4. Open the Leads page in the app: its source runs list shows a row for each channel that ran.

## 6. The browser extension for the production URL

The extension needs no rebuild. It stores the app URL and token in the browser, and it allows any `https://` origin as an optional permission.

1. If you have not built it: `node extension/build.mjs`, then in Chrome open `chrome://extensions`, turn on Developer mode, choose Load unpacked and select `extension/dist`.
2. Open the extension's Options page.
3. App URL: the production URL, for example `https://<your-app>.vercel.app`. Remote apps must use HTTPS.
4. Token: the exact `CAPTURE_TOKEN` value from the Vercel project (16 or more characters).
5. Click Save and accept Chrome's request for access to that one site. Saving also removes access to any previously configured app, such as `localhost`.
6. Open a SUPost listing and click Capture this page. The listing appears on the board of the production app.

If a capture is rejected: a 401 means the token differs from `CAPTURE_TOKEN` (or that variable is missing or under 16 characters). If Chrome shows no permission prompt, you are not saving from a click on Save. Changing `CAPTURE_TOKEN` in Vercel needs a redeploy before it takes effect, and the same change in the extension's Options.

## 7. Google is not used in production

Google's Maps Demo Key terms forbid production use, so the code decides at run time (`googleMode` in `src/lib/providers/fallbacks.ts`, tested in `tests/providers/google-policy.test.ts`):

| Where it runs | Order for transit | Order for geocoding, walking, biking | Order for nearby places |
| --- | --- | --- | --- |
| Your laptop (`VERCEL` not set, or `VERCEL_ENV=development`) | Google, then Transitland | Google, then Geoapify | Google, then Overpass |
| Vercel preview | Transitland, then Google | Geoapify, then Google | Overpass, then Google |
| Vercel production (also if `VERCEL_ENV` is missing) | Transitland only | Geoapify only | Overpass only |

Local runs keep Google first because it is the most accurate reference for checking the other providers. Preview deployments only use Google as a last resort and only if you set the key there; leave it out and previews behave like production.

### What gets worse without Google

One comparison run on 2026-11-24 (`npm run compare:providers`, script in `scripts/compare-providers.ts`): the first 6 demo listings, each routed to the example office, transit arriving 8:30 am on Tuesday 2026-12-01. Google and the free providers were asked the same questions.

| Feature | Google | Free provider | What changes |
| --- | --- | --- | --- |
| Transit commute (Transitland) | 6 of 6 answered | 6 of 6 answered | Median gap 0.5 min, but the gap is large on short trips: Google 13 and 9 min against Transitland 31 and 30 on two listings. Within 5 min on 3 of 6. Largest gap 21 min. Likely cause: Google can return a mostly walking trip where Transitland returns a transit trip. That is a hypothesis, not checked. |
| Caltrain zone and monthly pass | agency and both stations named on 6 of 6 | 0 of 6 | The biggest loss. Transitland's steps carry line names only, never stop names, so a Caltrain zone cannot be priced and the pass price stays Unknown rather than guessed. Any route whose agency is not recognised is also Unknown. Rent and utilities are unaffected, but the "all-in plus transit" figure is Unknown for these routes. |
| Walking time (Geoapify) | 6 of 6 | 6 of 6 | Geoapify is slower: median +3 min, largest +6 min, within 5 min on 5 of 6. |
| Biking time (Geoapify) | 6 of 6 | 6 of 6 | Median +1 min, largest +6 min (34 against 40 on the longest trip), within 5 min on 5 of 6. |
| Nearby places (Overpass) | 6 of 6 | 4 of 6 | Overpass failed with a network error on 2 listings, and those places show Unknown. On the 4 that answered, the nearest grocery matched within 13 m on 3 and differed on one (506 m against 971 m). Overpass also finds more gyms and cafes, because Google returns at most 20 results per search, so the counts are not like for like. |
| Place ratings | 17 to 20 of the 19 to 20 places returned had a rating | none of the places had one | Overpass has no ratings. Nothing in the app uses place ratings today, so no feature changes. |
| Geocoding (Geoapify) | 6 of 6 | 6 of 6 | The demo addresses are made up, so the two services returned different guesses (median 1,510 m apart). That says nothing about accuracy on real addresses. Check it against a few real listings before trusting it. |

What to do about the first two rows: the Transitland gap on short trips and the missing Caltrain stations are the reasons to keep the acceptance check (TASKS.md step 8, commute within 5 minutes of Google Maps) honest for production, and to look at a different transit source if the Caltrain pass price matters for your shortlist. The 511.org data used by `npm run gtfs` already knows the stations, but it is not used for routing.

## 8. If something goes wrong

- The board shows an error mentioning a missing column or table: run `npm run db:migrate` against Turso (section 4).
- Every commute is Unknown: check `TRANSITLAND_API_KEY` and `GEOAPIFY_API_KEY` are set for the environment you are looking at. Without Google there is no other source.
- The cron returns 504: the budget in `CRON_BUDGET` is too generous for the current speed of the model or map services. Lower `maxWork` in `src/lib/intake/run.ts`.
- Roll back: in Vercel, Deployments, pick an earlier deployment and promote it. The database is not rolled back, so write migrations to be additive.
