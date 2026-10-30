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
  tests first → implement → all tests green → security review → PR into `develop` → merge → delete branch.
- Fixes: `fix/<short-name>`. Docs only: `docs/<short-name>`. Same flow.
- Small commits, Conventional Commits style: `feat(ingest): accept batched events`, `test(auth): …`, `fix(ui): …`.
- One feature branch = one coherent, tested thing. Verify it works before starting the next.
- CI (GitHub Actions) runs lint + unit + e2e on every PR. Never merge red.

### Test-driven
- Write the failing test first, then the code, then refactor.
- Backend: Vitest with `@cloudflare/vitest-pool-workers` (runs inside the real Workers runtime, with a local D1).
- UI: Playwright against `wrangler dev`, covering every user flow in `docs/PLAN.md`.
- Functionality before polish: a screen must work end to end with the real API before visual refinement.
- A phase is only done when every box in its checklist is ticked and CI is green.

### Agents
This repo defines four subagents in `.claude/agents/`. You (the main session) are the **lead**:
you own the plan, git, branches, merges, and the API contract. Delegate:
- `backend`: Worker, API, D1, auth, storage adapters, Basin.
- `ui-builder`: the dashboard app (static HTML/CSS/JS served by the Worker).
- `landing-page`: the public landing page, README, install docs.
- `security-reviewer`: reviews every feature branch diff before merge. **A critical finding blocks the merge.**

Order of work: backend defines/updates `docs/API.md` first → ui-builder builds against it.
Landing page can run in parallel any time. Security review runs at the end of every feature branch.
Give each agent a narrow, explicit brief (branch name, files it owns, tests that must pass).

### Code style
- Plain JavaScript (ES modules) with JSDoc types. No TypeScript build step, no frontend framework.
- UI: vanilla HTML/CSS/JS, no bundler required. Small, readable files.
- Clear names over clever code. No dead code, no commented-out blocks.
- Never log secrets or full tokens. Never commit `.dev.vars` or real credentials.

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
| App DB | D1 (users, sessions, projects, sources, tokens, views, charts) |
| Log storage, local | D1 `logs` table (via `LocalStorage` adapter) |
| Log storage, prod | Basin Pipelines → Iceberg table in R2 → Basin SQL (via `BasinStorage` adapter) |
| Ingest | `POST /v1/logs` with `Authorization: Bearer <source token>` |
| Admin bootstrap | `ADMIN_PASSWORD` secret (first sign-in) |
| Install target | `npx create-open-logs` + "Deploy to Cloudflare" button |
| Design reference | `docs/design/` and the canvas link in `docs/design/README.md` |
