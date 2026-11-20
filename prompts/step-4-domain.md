You are doing step 4 (cost model, hard filters, scoring, Bay Area region pack) of the Apartment Finder, on branch step-4-domain in this worktree. Read AGENTS.md, TASKS.md, the last PROGRESS.md entries, docs/requirements.md ("Hard requirements", "True monthly cost model", "Location and neighborhood") and docs/design.md ("Scoring and ranking", "California scope") first. Plan before editing.

## Goal
The money math and ranking logic, as pure, fully tested functions with no I/O. This is the part that must be exactly right.

## You own
`src/lib/domain/`, `src/lib/regions/`, `tests/domain/`. Do not edit anything else.

## Build
1. Types: a `ListingFacts` input (every field nullable; null means Unknown) and a `Settings` input matching config/settings.example.json. Money in integer cents, durations in minutes.
2. Cost model: `computeCost(facts, settings, regionPack)` returns line items, each tagged confirmed or estimated with its source, plus `allInMonthlyCents`, `allInPlusTransitCents`, `upfrontCashCents` (refundable deposit and first payment), and `passesOnEstimatesOnly`. Spread one-time non-refundable costs over months of stay, where months = days from move-in to move-out divided by 30.4375. Round only at the end, half up, to whole cents. A missing recurring cost the region pack can estimate becomes an estimated line; one it cannot estimate stays Unknown and makes the total Unknown.
3. Hard filters: one function per dealbreaker in docs/requirements.md, each returning Pass, Fail or Unknown with a reason. Unknown results also return the exact question to ask the landlord. `$2,500.00` passes and `$2,500.01` fails.
4. Soft score: the curves in the design's scoring table, each mapping to 0..1, then a weighted sum to 0..100 using weights that are normalized to sum to 1. The budget headroom factor scores 1 when housing plus the transit pass is at or under the cap.
5. Feedback: `applyFeedback(weights, changes)` where each change is { factor, direction, size: small|medium } with small = 0.05 and medium = 0.1, capped at 0.1 per factor per reaction, clamped to 0..1, then renormalized. Returns the new weights and a human-readable change log ("Raised transit quality from 0.12 to 0.18").
6. Explanations: `explain(scoreBreakdown)` returns the top two strengths and the biggest weakness from the numbers, never free text.
7. Bay Area region pack in `src/lib/regions/bay-area.ts`, every number with a source URL and an as-of date, all marked estimate unless stated:
   - Caltrain monthly pass: 1 zone $96, 2 zones $150 (https://www.caltrain.com/fares). Menlo Park, Palo Alto, California Ave, San Antonio, Mountain View and Sunnyvale are Zone 3; Redwood City is Zone 2.
   - VTA monthly $90 (https://www.vta.gov/fares); SamTrans monthly $65.60; Stanford Marguerite free.
   - Utilities, internet ($45) and renter's insurance ($15) monthly defaults for a single person, marked estimate. Use a lower utilities default when the listing says utilities are included (then it is 0, confirmed).
   - A function that picks the cheapest pass that covers a given commute route's agencies and zones.
   Keep a `regions/index.ts` that returns Unknown values for any region without a pack.

## Tests (table-driven)
At minimum: the $2,500 boundary both ways; Unknown rent gives Unknown total and a Needs info result; utilities included vs estimated; a one-time fee spread over the stay; 12-month lease with a break fee; transit-fits bonus on and off; feedback cap, clamp and renormalization; explanation picks the right factors.

## Done when
`npm run check` passes; you commit on step-4-domain, append to PROGRESS.md, and flip step 4 with evidence. No em dashes in comments or docs.
