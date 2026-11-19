# Apartment Finder: agent guide

A single-user web app that helps Karthik find furnished housing near his office in California (Palo Alto first). It chats with him, pulls in listings automatically, computes true monthly cost and commute, ranks options, and learns from his feedback.

Full specs live in the repo and are the source of truth:
- `docs/requirements.md`: what the tool must do
- `docs/design.md`: architecture, APIs, data model, scoring, build plan

## Stack
Next.js (App Router) + TypeScript strict, Vercel AI SDK (OpenAI-compatible providers), Zod, Drizzle ORM + libSQL (local `data/dev.db`, Turso in production), MapLibre GL + OpenFreeMap, Tailwind + shadcn/ui, Vitest, Playwright. Hosted on Vercel Hobby.

## Folder map (each build step owns its folders)
- `src/db/`: Drizzle schema, migrations, seed
- `src/lib/providers/`: every external API client (the ONLY place allowed to call `fetch`)
- `src/lib/transit/`, `scripts/gtfs/`: GTFS rush-hour frequency job
- `src/lib/regions/`: region packs (transit pass prices, utility defaults). Bay Area first
- `src/lib/domain/`: cost model, hard filters, scoring. Pure functions only, no I/O
- `src/lib/intake/`: listing channels, extraction, validation, enrichment, dedupe
- `src/lib/agent/`: agent loop, tools, provider fallback, prompts
- `src/app/`: routes and screens; `src/components/`: shared UI
- `tests/`: unit, guard and e2e tests; fixtures under `tests/fixtures/`

## Commands
- `npm run dev`: local app
- `npm run check`: typecheck + lint + unit and guard tests. Must pass before every commit
- `npm run test:e2e`: Playwright
- `npm run smoke`: one live call per external API (uses real free quota, run sparingly)
- `npm run db:migrate`, `npm run db:seed`

## Golden rules (enforced by tests in `tests/guards/`)
1. No number comes from the model. Costs, commutes, filters and scores come only from `src/lib/domain/` and `src/lib/providers/`.
2. Every value written to the `facts` table has a provenance: `listing`, `landlord`, `estimate`, `api` or `me`.
3. No tool, route or job may send a message, email or payment. Gmail access is read-only and links inside emails are never opened.
4. No scraping. Code fetches listings only from SUPost's and RentCast's APIs. Never fetch Zillow, Craigslist, Airbnb, Furnished Finder, Zumper or Facebook URLs. Facebook posts arrive only through notification emails or the extension's user-clicked capture. The optional Apify channel stays disabled unless `ENABLE_APIFY=true`.
5. Every external call goes through a cached client in `src/lib/providers/`.
6. Secrets and personal details stay private. Never commit `.env*` (except `.env.example`) or `config/*.local.json`. Never read either file, and never write the employer, the real office address or personal finances into code, tests, docs, commit messages or PROGRESS.md. Use the example settings and neutral fixtures. Never read `process.env` in a `"use client"` file.
7. Edit only the files your step owns (see TASKS.md). Need a change elsewhere? Stop and report it.

## Conventions
- Money is integer cents. Durations are integer minutes. Dates are ISO strings (`YYYY-MM-DD`).
- Unknown stays `null` and shows as Unknown. Never default a missing value to 0.
- Validate every boundary (API responses, model output, tool arguments) with Zod.
- Provider clients return `{ ok: true, data } | { ok: false, error }` and never throw across module boundaries.
- Tests use recorded fixtures, never live APIs.
- Keep diffs small. No new dependencies without saying why in your report.

## Workflow for every session
1. Read `TASKS.md`, the last entries of `PROGRESS.md`, and `git log --oneline -10`.
2. Run `npm run check` before changing anything. If it fails, report that first.
3. Work only on the step you were assigned.
4. Done means the step's "Done when" in TASKS.md is met AND `npm run check` passes.
5. Commit on your step's branch, append an entry to `PROGRESS.md` (what changed, commands run with their output, assumptions, open risks), and flip only your step's status in TASKS.md. Never flip a status without pasted evidence.
6. Writing style in docs, comments and UI copy: no em dashes.
