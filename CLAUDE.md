# Open Logs

Open-source, self-hosted log management for your own Cloudflare account.
A team deploys it with one command, signs in, creates projects, connects sources (their apps),
sends logs over HTTP, and gets a Better Stack-style UI: live tail, search, filters, charts, dashboards.

**Why it exists:** Cloudflare Basin (Pipelines + Catalog + SQL) is cheap, serverless log/analytics
storage, but it has no product on top: no ingest auth per app, no log viewer, no charts without SQL,
no team login. Open Logs is that product layer, free and open source.

**Goal of this repo:** a polished, working showcase project. Keep v1 small, correct, and well tested.
Do not add scope that isn't in `docs/PLAN.md` without asking.

Read these before doing anything:
1. This file
2. `docs/PLAN.md`: phases and the "done means" checklist for each
3. `docs/ARCHITECTURE.md`: system design, data model, API contract
4. `docs/design/README.md`: the approved UI screens (match them)

---

## Working rules (non-negotiable)

### Ask first
The owner wants to be asked before you act on anything outside the repo. **Ask and wait for a yes before:**
- installing anything globally, or adding a new dependency not listed in `docs/ARCHITECTURE.md`
- creating the GitHub repo, changing repo settings, or pushing for the first time
- `wrangler deploy`, creating Cloudflare resources (D1, pipelines, streams, sinks, buckets, secrets)
- anything that costs money
- merging `develop` into `main` (a release)

Inside the repo, on a feature branch, you may write code, run tests, and commit freely.

### Git Flow
- `main` = production. Only release merges from `develop` land here, tagged `vX.Y.Z`.
- `develop` = integration. **Never commit directly to `develop` or `main`.**
- Every unit of work: `git switch develop && git pull` → `git switch -c feature/<short-name>` →
  implement → `npm run deploy:staging` and check on staging against real Basin →
  security review → PR into `develop` → merge → delete branch.
- Fixes: `fix/<short-name>`. Docs only: `docs/<short-name>`. Same flow.
- Small commits, Conventional Commits style: `feat(ingest): accept batched events`, `test(auth): …`, `fix(ui): …`.
- One feature branch = one coherent, tested thing. Verify it works before starting the next.
- Staging is an ordinary install kept in `.open-logs/`. `npm run deploy:staging -- --name <staging install>` deploys
  the current branch to it. `npm run staging:reset` (only from `develop`) wipes its D1 and redeploys `develop`.

### Testing
- There are no automated tests and no CI right now. 2026-10-31: all tests, CI and test packages were removed (owner decision). Tests will be rebuilt from scratch, one at a time, with the owner.
- Until then, changes are checked on a staging install against real Basin.
- Functionality before polish: a screen must work end to end with the real API before visual refinement.

### Agents
You (the main session) are the **lead**: you own the plan, git, branches, merges, and the API contract.
Work is delegated to subagents, each with a narrow, explicit brief (branch name, files it owns, tests that
must pass).

Order of work: the backend change updates `docs/API.md` first → the UI builds against it.
A security review runs at the end of every feature branch. **A critical finding blocks the merge.**

### Release rules
- Before the first release, migrations may be edited.
- After the first release, `migrations/0001_init.sql` is frozen. Every schema change is a new migration that
  only adds: new tables, new nullable or defaulted columns. Never remove or rename a table or column in the
  same release that stops using it, because the previous Worker version must keep working for rollback.
- Basin table columns (`basin/stream-schema.json`) are fixed once users have installed it. New log data goes
  into the `fields` JSON.
- Every release is tested as an update from the previous release: `npm run setup` from the old tag on a
  throwaway install → `npm run update` → check. Every release gets release notes.
- Standing rule, every change: prune obsolete or duplicate tests in the same change.

### Code style
- Plain JavaScript (ES modules, JSX in the UI) with JSDoc types. No TypeScript.
- Backend: Hono on Cloudflare Workers (`src/`). Handlers are small functions; routing lives in `src/routes/index.js`.
- UI: React + Vite single-page app (`app/`), React Router, plain CSS with the design tokens. No UI kit.
  Server data goes through React Query (`app/src/lib/queries.js`): load once and keep it; only live
  data refreshes (live tail, dashboard when new data lands), never while the tab is hidden; changes
  refresh exactly what they affect. Loading = a small pulsing green dot (`<Loader/>`), first load only.
  (Owner decision 2026-10-30: moved from vanilla multi-page HTML to React + Hono for instant navigation.)
- Clear names over clever code. No dead code, no commented-out blocks.
- Never log secrets or full tokens. Never commit `.dev.vars`, `.open-logs/` or real credentials.

### Honesty
- If something can't be done or verified (e.g. a Basin feature that doesn't run locally), say so
  plainly in the PR and in `docs/PLAN.md`. Don't paper over it.
- Before building on a Cloudflare API, check the current docs (links in `docs/ARCHITECTURE.md`).
  Basin went GA on 2026-10-01 and is new: verify names, limits, and endpoints, don't guess.

---

## Quick reference

| Thing | Value |
|---|---|
| Project name | Open Logs (`open-logs`) |
| Local path | `~/Documents/Personal/projects/open-logs` |
| Runtime | Cloudflare Workers + static assets |
| App DB | D1, app data only (users, sessions, invites, projects, sources, views, dashboards, charts, settings) |
| Log storage | Basin only: Pipelines stream → Iceberg table in R2 (Basin Catalog) → Basin SQL (`BasinStorage`). No local logs. |
| Plan | Workers Paid ($5/month), needed for Basin |
| Ingest | `POST /v1/logs` with `Authorization: Bearer <source token>` |
| Admin bootstrap | `ADMIN_PASSWORD` secret (first sign-in) |
| Install | `git clone` + `npm run setup` (writes `.open-logs/<name>.jsonc` and `.json`, gitignored) |
| Maintain | `npm run update`, `npm run rollback`, `npm run uninstall` (each asks the install name, or `-- --name`; Enter = `open-logs`) |
| Staging | an ordinary install, picked by name; `npm run deploy:staging`, `npm run staging:reset` |
| Local run | None. `npm run dev` only prints that Open Logs runs on Cloudflare. |
| Design reference | `docs/design/` and the canvas link in `docs/design/README.md` |
