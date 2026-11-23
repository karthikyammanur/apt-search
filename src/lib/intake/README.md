Listing channels, extraction, validation, enrichment and dedupe. Owned by step 5.

## Flow

Every post, from every channel, runs through `processRaw` in `pipeline.ts`. Each stage is its own exported function:

1. `stageExtract`: the only model call (`extract.ts`), then validation (`validate.ts`). The post text goes to the model between `<<<LISTING_TEXT_START>>>` and `<<<LISTING_TEXT_END>>>`, and the system prompt says it is data. The reply is checked again in code (`schema.ts`): a dollar amount must appear in the post, and a yes or no on a dealbreaker field (private bedroom, private bath, furnished, utilities, internet) needs matching words in the post, else it is dropped to Unknown. Screenshots skip these text checks.
2. `stageRoommate`: `roommate_wanted` posts go to `roommate_leads`, deduped by post URL.
3. `stageDedupe` (`dedupe.ts`): saved link, matching photo hash, or the same street address with rent within 5 percent. A duplicate merges into `source_links` (`stageMerge`). A shared photo at a clearly different address is not a merge: it fails the `photos_reused` scam check.
4. `stageTrust` (`trust.ts`) and `stageStore`: listing, `listing` facts, photos, and the `scamChecks` fact (provenance `estimate`, so a check resolved by hand wins).
5. `cheapFilters`: budget on known rent, move-in, lease, private bed and bath, furnished, scam checks, roommates. A Fail stops here with no map calls.
6. `stageEnrich` (`enrich.ts`): geocode (only an address with a street number), transit commute arriving 8:30 am on the first weekday on or after the start date, bike, nearest stops from `transit_stops`, grocery, gym and cafes. The nearest of each kind gets a routed walk (`api`); the rest are straight-line estimates (`estimate`).
7. `stageAnalyze` (`analysis.ts`): cost, full filters and score from `src/lib/domain/`, stored in `enrichment`.

Nothing in this folder calls `fetch`. Map and listing APIs go through `src/lib/providers/`, the model through `src/lib/llm/`.

## Where results are stored

- `facts`: field names are the keys of `ListingFactValues` (`rentCents`, `privateBath`, ...), the same names the domain questions use. Unknown is a missing row, never a null or 0.
- `enrichment.cost_breakdown` holds one versioned envelope `{ version, bucket, cost, filters, score, explanation }`. The table has no bucket or score column, so read it with `readAnalysis` (`analysis.ts`). `recompute(db, listingId, context)` reruns stage 7 from the current facts with no map call; step 6 calls it after recording an answer.
- `enrichment.scam_checks` holds `{ checks, details, medianCents }`.
- `listings.source_links` lists every place a listing was seen. RentCast has no public link, so its link is `rentcast:<id>`.

## Channels (`channels/`)

| Channel | Adapter | Notes |
| --- | --- | --- |
| SUPost | `supost.ts` | Title, price, date and link only; the API has no body. Skipped outside the Bay Area region. |
| Gmail alerts | `gmail.ts`, `email.ts` | Label `housing-alerts`. Body only, links kept as data and never opened. Craigslist, Zillow, HotPads and Facebook senders; other senders are ignored. A digest email is split into listings at each listing link. |
| RentCast | `rentcast.ts` | Radius search around the office. Structured data, so no model call. At most once every 6 days. Off without a key. |
| Extension | `capture.ts`, `src/app/api/capture/route.ts` | `POST /api/capture` with header `X-Capture-Token`. A page or a Facebook batch; anything else is rejected. |
| Paste | `intakeFromText` | For the chat in step 6. Writes no `channel_runs` row. |

`run.ts` runs the automatic channels and writes one `channel_runs` row each. A run that hit its per-run limit is recorded with a "deferred" note, so it is not counted as clean, and Gmail rereads one day of overlap so deferred mail is picked up.

## Running it

- `npm run intake:once -- [--channel supost|gmail|rentcast|all] [--limit 15] [--force]`: one run against the local database. Uses real free quota.
- `GET /api/cron/intake`: the daily run, scheduled in `vercel.json` at 14:00 UTC. Needs `CRON_SECRET` set in the Vercel project (Vercel sends it as `Authorization: Bearer ...`). With no secret set, it refuses every call.
- `CAPTURE_TOKEN` (in `.env.example`) is the shared token for the extension. Use a random string of 16 characters or more.
- Both `/api/capture` and `/api/cron/intake` sit behind `src/proxy.ts`, which needs a login cookie for every `/api/` path. It must let these two paths through (they have their own token checks). That file belongs to step 1.

## Open limits

- Email splitting is a heuristic over the email layout and is tested only on the saved samples in `tests/fixtures/intake/`. Recheck it against real emails.
- Route steps from the routing provider carry no agency or stop names, so a transit pass price is Unknown unless the line name says Caltrain, VTA, SamTrans or Marguerite, and a Caltrain zone is always Unknown.
- SUPost prices have no stated period. A price on a short sublet may not be a monthly rent.
