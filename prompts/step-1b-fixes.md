You are doing step 1b: small fixes to step 1 before three agents start working in parallel. Stay on branch step-1-harness. Read AGENTS.md, TASKS.md, the last PROGRESS.md entry, and docs/design.md "Data model" and "Facebook groups" first. Give a short plan, then do it.

## Changes

1. Schema gaps you flagged. Add these, with a migration:
   - `listings`: `post_type` (room_offered, whole_place_offered, roommate_wanted, unknown), `group_name` (nullable), `poster_profile_url` (nullable), `source_links` (JSON array of {source, url, seen_at}, for merged duplicates).
   - `photos`: `phash` (nullable text).
   - New `roommate_leads` table: id, source, post_url, poster_name, poster_profile_url, group_name, text, dates_wanted, budget_cents (nullable), status (new, messaged, talking, not_a_fit), notes, created_at.
   - New `channel_runs` table: id, channel (supost, gmail_alerts, rentcast, extension, facebook_capture, apify), group_name (nullable), ran_at, items_seen, items_new, error (nullable). Used for the daily per-channel counts and "last captured" times.
   - New `transit_stops` table, filled by step 3: stop_id, feed, name, lat, lng, modes (JSON), weekday_rush_departures, median_rush_headway_min (nullable), computed_at. Primary key (feed, stop_id).
2. facts uniqueness: change the unique index from (listing_id, field) to (listing_id, field, provenance), so a landlord's answer does not erase what the listing said. Add a pure helper in `src/db/` that picks the current value with priority landlord, me, listing, api, estimate.
3. Turn off `cacheComponents` and `partialPrefetching` in next.config.ts. This is a single-user app that reads cookies and the database on almost every page; simpler beats faster here.
4. Login rate limit: after 5 failed attempts in 15 minutes, reject for 15 minutes. Store attempts in the database (new small table `login_attempts`), not in memory, since Vercel functions do not share memory. Add a test.
5. Privacy hardening: add `Read(./.env)` and `Read(./.env.*)` (keeping `.env.example` readable) to the deny list in `.claude/settings.json`.
6. GTFS exception: step 3 must download GTFS zip files once, offline. Allow `fetch` in `scripts/gtfs/` in the fetch guard, and add one line to AGENTS.md rule 5 saying `scripts/gtfs/` may download GTFS feeds directly because it is an offline job, not app traffic.
7. TASKS.md (you may edit these rows only to add ownership, not status): step 2 also owns `src/lib/providers/gmail.ts`; step 3 owns `scripts/gtfs/` and `src/lib/transit/` and writes only to the `transit_stops` table; nobody but step 1 edits `src/db/`.

## Done when
`npm run check`, `npm run build` and `npm run test:e2e` pass; a fresh `db:migrate && db:seed` works; the rate limit test passes. Commit on step-1-harness, append to PROGRESS.md, and tell me it is ready to merge.
