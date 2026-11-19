You are working on step 1 (Scaffold and harness) of the Apartment Finder. Read AGENTS.md, TASKS.md, docs/requirements.md and docs/design.md first, then give me a short plan (files you will create, packages you will add) before editing.

## Goal
Set up the project skeleton and the safety harness so three agents can later work in parallel on separate folders without breaking each other. Build no features: no API clients, no domain logic, no agent, no screens beyond login and an empty home page.

## Already in the repo (do not rewrite)
AGENTS.md, CLAUDE.md, TASKS.md, PROGRESS.md, .env.example, .claude/settings.json, config/settings.example.json, docs/requirements.md, docs/design.md.

## Do
1. Next.js (App Router, latest stable) with TypeScript strict (`noUncheckedIndexedAccess` on), Tailwind, shadcn/ui init, ESLint, Prettier. Use npm.
2. Drizzle ORM with libSQL. Schema in `src/db/schema.ts` for every table in docs/design.md "Data model": listings, facts, enrichment, settings, preferences, feedback, roommates, chat, api_cache. Follow the columns listed there. Money in integer cents, minutes as integers, dates as ISO text, JSON columns for lists. `facts.provenance` is an enum: listing, landlord, estimate, api, me.
3. Migrations plus `src/db/seed.ts`. Seed settings from `config/settings.local.json` if it exists, otherwise from `config/settings.example.json` (validate both with the same Zod schema). Never copy values from the local file into code, tests, docs or PROGRESS.md. Also seed equal starting weights for the soft factors in docs/design.md "Scoring and ranking".
4. Empty folders with a one-line README each: `src/lib/{providers,transit,regions,domain,intake,agent}`, `scripts/gtfs`, `extension`, `tests/{providers,transit,domain,intake,fixtures}`.
5. Password gate: `src/middleware.ts` checks a signed, httpOnly cookie; `src/app/login/` page compares against `APP_PASSWORD`. Everything except /login and static assets requires it.
6. Tests: Vitest for unit and guard tests, Playwright with one e2e test (wrong password is rejected, right password reaches the home page).
7. npm scripts: `dev`, `build`, `check` (tsc --noEmit, eslint, vitest run), `test:e2e`, `smoke` (for now prints "no providers yet" and exits 0), `db:migrate`, `db:seed`.
8. Guard tests in `tests/guards/` that scan source files:
   - `fetch(` appears only under `src/lib/providers/`
   - no file under `src/` fetches a URL containing zillow, craigslist, airbnb, furnishedfinder, zumper or facebook
   - no `"use client"` file reads `process.env`
   - if `src/lib/agent/` exports a tool registry, no tool name contains send, email, reply, pay or purchase (skip cleanly while the registry does not exist)
   - Gmail scopes anywhere in `src/` are only `gmail.readonly`
9. Husky pre-commit hook that runs `npm run check`.
10. `.gitignore` covers `.env*` except `.env.example`, `config/*.local.json`, `data/*.db`, `.vercel`, Playwright output.

## Constraints
- Touch only files step 1 owns in TASKS.md, plus root config files.
- Do not read `.env.local`. Do not add packages beyond what the list above needs; name each one in your report.
- No em dashes in any docs, comments or UI copy.

## Done when
- `npm run check`, `npm run build` and `npm run test:e2e` all pass.
- For each guard test: you add a deliberate violation, show the test failing, remove it, show it passing. Paste that output.
- `npm run db:migrate && npm run db:seed` works on a fresh clone.
- You commit on branch `step-1-harness`, append to PROGRESS.md, and flip step 1 in TASKS.md to Passing with the evidence.

## Report back
Files created, packages added and why, commands run with their output, assumptions you made, and anything I need to do by hand (for example, Vercel import).
