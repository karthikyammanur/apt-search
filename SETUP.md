# Setup: from this kit to step 1

1. Create the repo
   ```
   mkdir apartment-finder && cd apartment-finder && git init -b main
   ```
2. Copy everything from this kit into the repo root (including the hidden `.claude/` folder and `.env.example`). Move `prompts/` into the repo too.
3. Export both docs as Markdown (doc name menu, Export, Markdown) and save them as:
   - `docs/requirements.md` (Palo Alto Apartment Finder: Requirements)
   - `docs/design.md` (Palo Alto Apartment Finder: System Design)
4. Check that the kit's `.gitignore` is in the repo root (it keeps `.env.local` and `config/settings.local.json` out of git). Then: `git add -A && git commit -m "Harness kit and specs"`. Push to GitHub (public is fine; nothing personal is committed).
5. Private settings: copy `config/settings.example.json` to `config/settings.local.json` and put your real office address and dates there. It is git-ignored and agents are blocked from reading it.
6. Step 0 (you, in parallel with step 1): fill `.env.local` from `.env.example`. Start with `APP_PASSWORD`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_MAPS_DEMO_KEY`. The rest are needed by step 2.
7. Step 1: open the repo in VS Code, start Claude Code, paste `prompts/step-1-harness.md`.

## Running steps 2 to 4 in parallel (after step 1 is merged)
Each agent gets its own worktree, so they never touch each other's files:
```
git worktree add ../af-step-2 -b step-2-providers
git worktree add ../af-step-3 -b step-3-gtfs
git worktree add ../af-step-4 -b step-4-domain
```
Open each folder in its own VS Code window: Codex in af-step-2 and af-step-3, Claude Code in af-step-4. Copy `.env.local` into af-step-2 only. Merge each branch into main after its review.

**Turso:** `npm run db:migrate` and `npm run db:seed` use `file:data/dev.db` and do not read `.env.local`; to run them against Turso, set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in your shell first (PowerShell: `$env:DATABASE_URL="libsql://..."`; bash: `export DATABASE_URL=libsql://...`).
