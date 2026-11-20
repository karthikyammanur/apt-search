# Build tasks

Status is `Failing` until the step's "Done when" is met with evidence in PROGRESS.md. Agents may only change their own step's status.

| # | Step | Agent | Branch | Owns | Done when | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Free keys and saved-search alerts | Karthik | none | `.env.local` | Every key in `.env.example` has a value in `.env.local` | Failing |
| 1 | Scaffold and harness | Claude Code | `step-1-harness` | repo root config, `src/db/`, `src/proxy.ts`, `src/app/login/`, `tests/guards/`, `tests/e2e/`, `.claude/`, `.husky/` | `npm run check`, `npm run build` and `npm run test:e2e` pass; each guard test shown failing on a deliberate violation, then passing | Passing |
| 2 | API clients with caching | Codex | `step-2-providers` | `src/lib/providers/` (including `src/lib/providers/gmail.ts`), `tests/providers/`, `tests/fixtures/providers/`, `scripts/smoke.ts` | Fixture tests pass with no live calls; `npm run smoke` hits each API once and confirms the Google Demo Key returns a transit route (else transit falls back to TravelTime) | Failing |
| 3 | Rush-hour frequency job | Codex | `step-3-gtfs` | `scripts/gtfs/`, `src/lib/transit/`, `tests/transit/`; writes only to the `transit_stops` table | Prints weekday 7 to 9 am frequency for California Ave Caltrain and Palo Alto Transit Center; fixture test passes | Passing |
| 4 | Cost model, filters, scoring, Bay Area region pack | Claude Code | `step-4-domain` | `src/lib/domain/`, `src/lib/regions/`, `tests/domain/` | Table-driven tests pass, including the $2,500 boundary, Unknown to Needs info, and the transit-fits bonus | Failing |
| 5 | Intake pipeline and listing channels (SUPost, Gmail alerts incl. Facebook group emails, RentCast, extension endpoint, post classifier) | Claude Code | `step-5-intake` | `src/lib/intake/`, `tests/intake/` | 5 fixture listings run end to end with a stubbed model; 1 live run is correct | Failing |
| 6 | Agent, tools, provider fallback, chat UI | Claude Code | `step-6-agent` | `src/lib/agent/`, `src/app/chat/`, `src/app/api/chat/` | E2E: paste a listing, its card shows cost and commute; thumbs down with a reason shows a weight change | Failing |
| 7 | Screens and browser extension (incl. Facebook capture-visible-posts mode, photos, daily Facebook round) | Codex | `step-7-screens` | `src/app/(views)/`, `src/components/`, `extension/` | Map, board, detail, compare, requirements and settings render from a seeded DB at desktop and phone widths | Failing |
| 8 | Acceptance check | Karthik + fresh reviewer | none | none | 10 of 10 real listings match hand-checked cost, commute (within 5 min of Google Maps) and filter results | Failing |

Order: 1, then 2, 3 and 4 in parallel, then 5, then 6 and 7 in parallel, then 8.

Only step 1 edits `src/db/` (schema, migrations, seed). A step that needs a schema change stops and reports it.
