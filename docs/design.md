# Palo Alto Apartment Finder: System Design

Nov 18, 2026 · @goat

## At a glance

&#91;embedded content: architecture · browser, server, database, free APIs\]

Only the agent loop talks to a model. Costs, commutes, filters and scores come out of the pipeline as finished facts, so the model can quote them but never invent them.

## Free API stack

Listings now arrive automatically, and Google Maps is back through its new [Maps Demo Key](https://developers.google.com/maps/demo-key), which needs no billing account and pauses for the day at its limit instead of charging. Nothing in this stack keeps a credit card on file, so nothing can bill me. Checked 2026-11-18.

| Job | Pick | Free limit | Backup |
| --- | --- | --- | --- |
| AI model | [Gemini API](https://ai.google.dev/gemini-api/docs/openai) free tier: 3.5 Flash-Lite for routine turns, 3.8 Flash for screenshots | Unpublished; observed about 500/day Flash-Lite, about 20/day Flash (unofficial) | OpenRouter `nvidia/nemotron-3.5-super-vl:free` (tools and images, 50/day), then Groq, SambaNova (20/day per model), Z.ai GLM Flash, local Ollama |
| Transit commute | Google Compute Routes, transit mode, arrive by 8:30 am, on the Demo Key | Daily limit unpublished; pauses, never bills | [TravelTime](https://traveltime.com/pricing) Basic (no card, personal use), then [Transitland](https://www.transit.land/plans-pricing) (1,000/month) |
| Walk and bike | Google Compute Routes on the Demo Key | Same daily pause | openrouteservice (2,000/day) |
| Geocoding | Google Geocoding v4 on the Demo Key | Same daily pause | Geoapify (3,000/day) |
| Grocery, gyms, cafes | Google Places API (New) Nearby Search on the Demo Key (no reviews or photos), checked against OpenStreetMap Overpass | Same daily pause; Overpass fair use | Overpass alone |
| Rush-hour frequency | [511.org](https://511.org/open-data/transit) and other GTFS feeds for the agencies near the office (511.org covers the Bay Area; Stanford Marguerite has its own feed), computed offline | Downloaded once | Transitland REST |
| Map | MapLibre with [OpenFreeMap](https://openfreemap.org/) tiles | No key, no limit | Google Dynamic Maps on the Demo Key |
| Listings: SUPost | [SUPost](https://supost.com/llms.txt) public API, polled daily for rooms, shares and sublets (Stanford area only; skipped for other offices) | About 60 requests/min; personal and agent use allowed | SUPost Atom feed |
| Listings: alert emails | Gmail API, read-only: parses new-listing alerts from Craigslist and Zillow/HotPads saved searches. Reads the email body only, never opens links | Free at this volume | none |
| Listings: studios | RentCast long-term rentals, radius search around the office | 50 requests/month; may need a card, confirm before enabling | skip |
| Listings: one click | Send to finder browser extension for pages I open myself (Furnished Finder, Airbnb, Facebook) | Free | Paste, as a last resort |
| Price baseline | [HUD Fair Market Rent API](https://www.huduser.gov/portal/dataset/fmr-api.html), [Zillow research CSVs](https://www.zillow.com/research/data/), SUPost market stats, my saved listings | Free | none |
| Reverse image check | Open in Google Lens button plus photo-hash matching across my saved listings | Free | none |

**Optional channel, off by default (my call):** the Apify free plan gives $5 of credit a month with no card, and runs stop when it's used up. A Craigslist housing scraper fits in that budget about every other day. Craigslist's terms ban scraping, so this stays off unless I turn it on.

**Ruled out, and why**

- Google Maps with a billing account: needs a card. The Demo Key covers the same calls without one.
- HERE: retired its no-card plan on Aug 31, 2025.
- Cerebras: its free credit now requires adding a card.
- OpenRouter as the primary model: 50 free requests/day unless $10 of credit is bought once (then 1,000/day). Kept as a fallback instead.
- Google Places reviews, Yelp, Reddit API: the Demo Key excludes reviews, Yelp has no free tier, and Reddit's Data API is closing to new apps.
- Running the app on my Claude or ChatGPT plan: Anthropic's terms require API keys for apps built on Claude, and OpenAI recommends API keys for automation.
- Apify scrapers for Furnished Finder and Zillow: Furnished Finder needs paid proxies, and Zillow returns 10 results per run on the free plan.

**Privacy note:** Gemini's free tier and some OpenRouter free models may train on prompts. Listing text is fine. Never paste my ID, bank or offer-letter details into chat. Turns that need privacy can go to Z.ai GLM Flash (no training by default) or local Ollama.

**Terms note:** Google says the Demo Key is for prototyping and testing. A single-user tool used for a few weeks is close to that, and if Google ever cuts it off, the backups take over automatically.

**California scope.** Google routes and places, TravelTime, Transitland, RentCast, HUD, Zillow data and the Craigslist and Zillow alerts all cover the whole state, and California's deposit and application-fee rules apply everywhere. The only regional parts are a small region pack: local transit feeds and pass prices, the utility provider's cost defaults, and SUPost. The Bay Area pack is built first. If the office moves elsewhere in California, the tool shows transit pass and utility costs as Unknown and asks me until that region's pack is added.

## Tech stack and hosting

TypeScript end to end, on tools I already use, hosted free with no card.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js (App Router) + TypeScript | One repo for UI and server routes; deploys to Vercel with no config |
| AI | Vercel AI SDK with the OpenAI-compatible provider | Streaming chat, tool calling with Zod schemas, provider swap by config |
| Validation | Zod | Same schemas for tool arguments, extraction output and API responses |
| Database | libSQL via Drizzle ORM: a local SQLite file in dev, [Turso](https://turso.tech/pricing) free in production | SQLite everywhere; Turso free is 5 GB, no card |
| Map | MapLibre GL + OpenFreeMap | Free tiles, no key |
| UI | Tailwind + shadcn/ui | Fast, clean components; mobile-friendly |
| Tests | Vitest (unit), Playwright (one end-to-end flow) | Computational checks the agents must pass |
| Hosting | [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Free, no card, allowed for personal use, functions run up to 300 s (enough for streamed AI replies) |
| Access | One password in an environment variable, checked by middleware | Single user; keeps the app and its API keys private |

All API keys live in server environment variables and never reach the browser. Fallback if Vercel ever changes: the same app runs locally with `npm run dev`.

## Data model

One SQLite file holds everything. The key design choice is the `facts` table: every value carries where it came from, which is how the app shows Confirmed vs Estimated and never passes a guess off as a fact.

| Table | Holds | Key columns |
| --- | --- | --- |
| `listings` | One row per place | id, source, url, raw\_text, type (room, studio, apartment), address, lat, lng, city, status (New, Interested, Contacted, Video tour, Applied, Rejected), first\_seen, last\_checked |
| `facts` | Every field of a listing, with provenance | listing\_id, field (rent, furnished, private\_bath, available\_from, lease\_terms, fees, utilities\_included, deposit...), value, provenance (listing, landlord, estimate, api, me), source\_url, checked\_at |
| `enrichment` | Computed results per listing | commute\_transit\_min, route\_steps, commute\_bike\_min, nearest\_stop, stop\_walk\_min, rush\_headway\_min, pois (grocery, gym, cafes with walk minutes), cost\_breakdown, all\_in\_monthly, all\_in\_plus\_transit, scam\_checks, review\_summary, computed\_at |
| `preferences` | My dealbreakers and weighted preferences | key, kind (hard, soft), value, weight, set\_by (me, chat), history |
| `feedback` | My reactions to listings | listing\_id, verdict (up, down), my\_words, weight\_changes, created\_at |
| `roommates` | People I'd live with | listing\_id, name, status (Messaged, Call scheduled, Met), notes |
| `chat` | Conversation history plus rolling summaries | role, content, created\_at, summary\_of |
| `api_cache` | Saved API responses, so the free quota lasts | provider, request\_hash, response, fetched\_at, expires\_at |

A `settings` table holds my editable inputs: office address, move-in and move-out dates, budget cap, max commute, room rules. Changing budget, dates or room rules rechecks every listing instantly. Changing the office address recomputes commutes for the top listings first and the rest over the next day, to stay inside free map limits.

A `photos` table stores each listing's image links (listing\_id, url, position, source). Links come from the browser button, SUPost or RentCast when they include images, and the image links inside alert emails. Photos display directly in my browser from the original links; the server never downloads them, so no rule about fetching listing sites is broken. Each photo gets an Open in Google Lens button for the reverse image check.

## AI layer

One agent loop with a small set of typed tools. The model talks, interprets and explains; it never computes a cost, a commute or a pass/fail. Those come back from tools as finished facts, and the model must quote them, not restate them from memory.

**Tools the agent can call** (arguments validated with Zod before anything runs)

| Tool | What it does | Writes to |
| --- | --- | --- |
| `get_requirements` | Returns my current dealbreakers and weights | nothing |
| `update_preference` | Changes a weight, a rule or a setting (office, dates, budget), with a reason I can see and undo | `preferences` |
| `add_listing` | Takes a URL, pasted text or screenshots and runs the intake pipeline | `listings`, `facts` |
| `answer_missing` | Records an answer I gave for a missing field (provenance: me) | `facts` |
| `get_shortlist` | Ranked listings with score breakdowns | nothing |
| `get_listing` | Full detail: costs, route, places, reviews, scam checks | nothing |
| `compare` | 2 to 4 listings side by side | nothing |
| `record_feedback` | Saves my reaction and the weight changes it implies | `feedback`, `preferences` |
| `set_status` | Moves a listing on the board | `listings` |
| `draft_message` | Drafts a landlord or roommate message for me to copy | nothing |
| `search_links` | Builds ready-made search URLs per site from my requirements | nothing |

**Rules**

- No tool can send a message, email, or payment. Drafts only.
- Listing text and fetched pages are untrusted input. They go to the model inside clear delimiters, and any instructions inside them are ignored. There are no outbound tools for an injected instruction to abuse.
- Context stays small: the system prompt carries my requirements, the current shortlist summary and a rolling chat summary, not the full history.
- Provider-agnostic client: one OpenAI-compatible interface so the primary free model and the fallback can be swapped by config (providers chosen in the Free API stack section).

## Scoring and ranking

Ranking is plain code with numbers I can inspect. The AI's only role is turning my words into small, visible weight changes.

**Stage 1: hard filter (code).** Each dealbreaker returns Pass, Fail or Unknown. Any Fail drops the listing. Unknown puts it in a Needs info bucket with the exact questions to ask the landlord, so a good place is never silently hidden because a field was missing.

**Stage 2: soft score (code).** Each factor maps to 0 to 1 with a fixed curve, then a weighted sum gives a 0 to 100 score.

| Factor | 1.0 when | 0 when |
| --- | --- | --- |
| Commute | 15 min or less | 30 min |
| Transit quality | Caltrain or frequent line within 5 min walk | stop at 10 min, every 30 min |
| Budget headroom | Housing plus transit pass under $2,500 | housing exactly $2,500 |
| Grocery | 5 min walk | 20 min walk |
| Gym | 5 min walk | 25 min walk |
| Cafes | 3 or more within 10 min walk | none within 15 min |
| Reviews and trust | strong recent reviews, all scam checks pass | mixed or no reviews |
| Lease fit | exact Jan to Aug term | needs a paid break clause |

Weights start equal and are stored in `preferences`.

**Stage 3: learning from feedback.** When I react ("too far from Caltrain"), the model calls `record_feedback` with a structured change, such as transit quality up by a small step. Steps are capped (no single reaction moves a weight more than 0.1), logged, shown in chat ("Raised transit quality from 0.12 to 0.18") and undoable. New rules I state ("no ground floor") become preferences checked during intake.

**Explanations.** Every card shows its top two strengths and its biggest weakness, generated from the score breakdown, never invented.

## Listing intake pipeline

Every listing goes through the same fixed pipeline. Only step 3 uses the model; every other step is code, so each one can be tested on its own.

1. **Input.** Listings arrive on their own: a daily SUPost poll, new alert emails in Gmail, a weekly RentCast studio search, and pages I send with the browser button. Pasting text or screenshots into chat still works as a fallback.
2. **Source.** Each channel has an adapter that turns what it receives (API JSON, an email body, a page my own browser already loaded) into raw text plus a source link. The server never fetches Zillow, Craigslist, Airbnb, Furnished Finder or Zumper pages itself, and never opens links inside emails.
3. **Extract (model).** Structured output into the listing schema. Every field is filled only from the text, tagged provenance listing, and left null if absent. No guessing.
4. **Validate (code).** Schema check plus sanity rules (rent $300 to $10,000, dates inside 2026 to 2027, city in the search area).
5. **Ask.** Missing load-bearing fields (lease term, private bath, utilities, move-in date) become chat questions for me, or questions to send the landlord.
6. **Geocode and enrich.** Coordinates, transit and bike commute, nearest stop and rush-hour frequency, nearby grocery, gyms and cafes. All responses cached.
7. **Cost.** Compute all-in monthly and housing plus transit from the cost model.
8. **Trust.** Rule-based scam checks, price vs area baseline, duplicate-photo check against my own saved listings, and a summary of any reviews I paste for the building or management company.
9. **Filter and score.** Stage 1 and 2 from Scoring. The listing lands on the board in New or Needs info.
10. **Dedupe.** Same normalized address plus similar rent, or matching photo hashes, merges into one listing with both sources linked.

A Recheck button reruns steps 2 and 6 to 9, and the card shows when it was last checked.

## Facebook groups

Facebook gives apps no way to read group posts: Meta removed its Groups API in April 2024. So the tool collects group posts through my own account and my own browser, three ways, and never logs a bot in as me.

1. **Notification emails.** I turn on email notifications for new posts in my 3 to 5 best groups. The Gmail parser handles Facebook post emails like any other alert: it reads the snippet in the email body, creates a listing in Needs info, and keeps the post link for me to open. Step 5 checks what these emails actually contain before relying on them.
2. **Capture visible posts.** The browser extension gets a Facebook mode. While I scroll a group or its search results, one click sends every post on screen: text, poster name and profile link, post time, photo links and post link. No auto-scrolling, no background crawling; nothing runs unless I click.
3. **Daily Facebook round.** The app lists my groups with ready-made group search links ("furnished private bath", "sublet January", "Caltrain") and when I last captured each, so a full check takes about 10 minutes.

**Processing.** The model sorts each post into room offered, whole place offered, roommate wanted, or irrelevant, and drops irrelevant ones. Offered places go through the normal pipeline with `source = facebook_group`, plus `group_name` and `poster_profile_url`. Roommate-wanted posts go to a Possible roommates list (a fellow intern to rent a 2-bed, 2-bath with), with an intro message drafted for me to send myself.

**Trust.** Facebook posts carry more scam risk, so each one gets extra checks I complete by hand: how old and active the poster's profile is, a mutual connection or matching LinkedIn, and a Google Lens check of the photos.

**Not doing:** a bot logged into my account, or auto-scrolling groups. That breaks Meta's terms and can get my account restricted, which would cut me off from the groups entirely.

## Build plan

Nine steps (0 to 8) over about 5 days. Claude Code takes the parts where rules must hold (money math, the agent, the pipeline). Codex takes well-specified, separate pieces (API clients, the data job, screens). At most 3 agents run at once, each on files no other agent touches.

| # | Step | Agent | Files it owns | Done when | Runs |
| --- | --- | --- | --- | --- | --- |
| 0 | Get free keys: AI Studio (Gemini), OpenRouter, Groq, SambaNova, Z.ai, Google Maps Demo Key, TravelTime, Gmail API (read-only), 511.org, HUD, Turso; Vercel account; saved-search alerts on Craigslist and Zillow/HotPads | Me, about 20 min | `.env.local` | Every key in `.env.example` has a value | Day 1 |
| 1 | Scaffold and harness: Next.js, Drizzle schema for all tables, password middleware, test setup, CLAUDE.md and AGENTS.md, TASKS.md, PROGRESS.md, pre-commit hook | Claude Code | repo root, `src/db/`, `src/middleware.ts` | `npm run check` passes and a hello page is live on Vercel | Day 1 |
| 2 | API clients with caching: Google Demo Key (routes, places, geocoding), TravelTime and Transitland backups, Overpass, SUPost, RentCast, HUD | Codex | `src/lib/providers/` | Fixture tests pass with no live calls; `npm run smoke` hits each live API once for the office address and confirms the Demo Key returns a transit route (if not, transit switches to TravelTime) | Day 2, parallel |
| 3 | Rush-hour frequency job from GTFS feeds for the office's region (Bay Area first) | Codex | `scripts/gtfs/`, `src/lib/transit/` | Prints weekday 7 to 9 am frequency for the California Ave Caltrain stop and Palo Alto Transit Center; fixture test passes | Day 2, parallel |
| 4 | Cost model, hard filters, scoring (pure functions), plus the Bay Area region pack (pass prices, utility defaults) | Claude Code | `src/lib/domain/` | Table-driven tests pass, including the $2,500 boundary, Unknown to Needs info, and the transit-fits bonus | Day 2, parallel |
| 5 | Intake pipeline and channels: SUPost poller, Gmail alert parser, RentCast search, browser-button endpoint, daily scheduled run, AI extraction, validation, enrichment, dedupe | Claude Code | `src/lib/intake/` | 5 pasted fixture listings run end to end with a stubbed model; 1 live run is correct | Day 3, after 2 to 4 |
| 6 | Agent, tools, provider fallback, chat UI | Claude Code | `src/lib/agent/`, `src/app/chat/`, `src/app/api/chat/` | End-to-end test: paste a listing, its card shows cost and commute; a thumbs down with a reason shows a weight change | Day 4, after 5 |
| 7 | Map, shortlist board, listing detail, compare, requirements and settings screens, plus the Send to finder browser extension | Codex | `src/app/(views)/`, `src/components/` | Screens render from a seeded database on desktop and phone width | Day 4, parallel with 6 |
| 8 | Acceptance check (see Harness) | Me, plus a fresh Claude session as reviewer | none | 10 of 10 real listings match my hand-checked numbers | Day 5 |

Each step ends with a commit and a TASKS.md status flip. Before step 5 starts, a fresh Claude session reviews steps 2 to 4 against the review checklist in Harness.

## Harness

The rules that make this "work 100%" are enforced by tests and hooks, not just written in a prompt.

**CLAUDE.md and AGENTS.md** (same content, under 60 lines): stack, folder map, the commands `npm run check` (typecheck, lint, tests) and `npm run smoke`, and these rules:

1. No number comes from the model. Costs, commutes, filters and scores come only from `src/lib/domain/` and `src/lib/providers/`.
2. Every value saved to `facts` has a provenance.
3. No tool may send a message, email or payment.
4. No scraping: code fetches listings only from SUPost's and RentCast's APIs. Gmail access is read-only and links in emails are never opened. The optional Apify channel stays off unless I turn it on.
5. Every external call goes through a cached provider client.
6. Never commit `.env*`; keys stay server-side.
7. Edit only the files your step owns.

**Enforced mechanically**

- Pre-commit hook and a Claude Code Stop hook both run `npm run check`.
- A test fails if any code outside `src/lib/providers/` calls `fetch`, or if any code fetches a Zillow, Craigslist, Airbnb, Furnished Finder, Zumper or Facebook URL.
- A test fails if the agent's tool list contains a send, email or pay tool.
- Provider tests use recorded fixtures, so tests never burn free quota.
- TASKS.md lists each step as Failing or Passing; agents may only flip status, with evidence in PROGRESS.md.

**Review checklist** (fresh Claude session, per step)

- [ ] Rules 1 to 7 hold.
- [ ] Rate-limit errors (429) fall through to the backup provider.
- [ ] Unknown values stay Unknown, never 0 or a guess.
- [ ] No API key reaches client code.

**Acceptance check (step 8)**

I collect 10 real listings and check each by hand. The app passes only if, for all 10: the all-in cost matches mine exactly, the transit commute is within 5 minutes of Google Maps (website) for a Monday 8:30 am arrival, and every hard-filter result matches my call. Any miss gets a fix plus a new test for that case.

## Risks and fallbacks

The biggest risks are free limits I don't control and thin supply at my price. Each one has a planned way out.

| Risk | What goes wrong | Plan |
| --- | --- | --- |
| Gemini free limits are unpublished and were cut in Dec 2025 | Chat stops mid-day | Automatic fallback to OpenRouter, Groq, SambaNova, Z.ai, then local Ollama; cache every extraction; keep the system prompt small |
| Google Demo Key limits are unpublished, and it is meant for prototyping | Commute lookups pause for the day or stop | Run cheap checks first and route only listings that pass; cache every route; switch automatically to TravelTime, then Transitland |
| A site changes its alert email format | A channel quietly stops adding listings | Parser tests on saved sample emails; the app shows a daily count per channel and flags one that drops to zero |
| OpenStreetMap is missing a gym or grocery store | Wrong walk scores | Spot-check the search area once; I can add a place by hand |
| Few furnished rooms with a private bath under $2,500 | Short shortlist | Widen to Redwood City and Sunnyvale; on request, show near misses and say exactly which rule they break |
| Scam listings target out-of-state renters | Lost deposit | Scam checks are dealbreakers; never pay before a live video tour and a signed lease |
| Office address turns out different | Every commute is wrong | Address is one setting; changing it recomputes every listing |
| A free host changes its terms | App goes down | The same app runs locally with `npm run dev` |

## Sources

Linked inline in the Free API stack and Tech stack tables. Transit pass prices for the cost model: [Caltrain fares](https://www.caltrain.com/node/11802), [VTA fares](https://www.vta.gov/fares), [Stanford Marguerite (free, public)](https://transportation.stanford.edu/getting-stanford/public-transit). Deposit rules: [California AG security deposit guide](https://www.oag.ca.gov/system/files/media/Know-Your-Rights-Security-Deposits-English.pdf). Scam red flags: [FTC rental listing scams](https://consumer.ftc.gov/articles/rental-listing-scams).
