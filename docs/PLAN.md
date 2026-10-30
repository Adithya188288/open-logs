# Open Logs: build plan

Each phase is one or more feature branches off `develop` (see Git Flow in `CLAUDE.md`).
Tick boxes as they're done. A phase is done only when every box is ticked and CI is green.
Phases 0–4 run fully locally and cost nothing. Phase 5 needs the owner's Cloudflare Workers Paid plan.

---

## Phase 0: Repo and tooling
**Agent:** lead. **Ask first** before creating the GitHub repo or installing global tools.

- [ ] Confirm `gh auth status` and `wrangler whoami` work (owner logs in if not)
- [ ] `git init`, initial commit on `main`, create `develop` from `main`
- [ ] Create public GitHub repo `open-logs`, push `main` and `develop`, set default branch `develop`
- [ ] Protect `main` and `develop` (PRs only, CI must pass) if the owner agrees
- [ ] `package.json`, `wrangler.jsonc`, `.gitignore` (incl. `.dev.vars`, `.wrangler/`, `node_modules/`)
- [ ] Vitest + `@cloudflare/vitest-pool-workers` set up, one passing smoke test
- [ ] Playwright set up, one passing smoke test against `wrangler dev`
- [ ] GitHub Actions: lint + unit + e2e on every PR
- [ ] `README.md` stub, `LICENSE` (MIT), `docs/API.md` stub

**Done means:** `npm test` and `npm run test:e2e` pass locally and in CI; `npm run dev` serves a hello page.

## Phase 1: Backend core
**Agent:** backend. Branches: `feature/db-schema`, `feature/auth`, `feature/projects-sources`, `feature/ingest`, `feature/query-api`.

- [ ] D1 migrations for every app table in `docs/ARCHITECTURE.md`
- [ ] Auth: first sign-in with `ADMIN_PASSWORD` creates the owner; email + password sign-in;
      sessions in D1 with an HttpOnly, Secure, SameSite=Lax cookie; sign-out
- [ ] Users: owner invites teammates (email + role), invite link sets password, roles `owner|admin|member`
- [ ] Projects: create, list, rename, delete
- [ ] Sources: create inside a project, returns token **once**; store only a SHA-256 hash + short prefix;
      regenerate token; delete
- [ ] Ingest `POST /v1/logs`: bearer token → source + project, accepts one event or an array,
      validates and normalises, stamps `project_id`/`source` **server side**, size limits, per-token rate limit
- [ ] Query API: structured filter (never raw SQL from clients), mandatory time range, limit, cursor paging;
      histogram endpoint (counts by bucket and level)
- [ ] `docs/API.md` kept current with every endpoint, request, response, and error

**Done means:** integration tests cover: sign in → create project → create source → ingest → query it back;
bad token → 401; oversized batch → 413; no session → 401 on app routes.

## Phase 2: Storage adapter (local first)
**Agent:** backend. Branch: `feature/storage-adapter`.

- [ ] `LogStorage` interface: `write(events)`, `query(filter)`, `histogram(filter)`
- [ ] `LocalStorage`: D1 `logs` table, JSON fields via `json_extract`, indexes on (project_id, ts)
- [ ] Adapter chosen by env var `LOG_STORAGE=local|basin`
- [ ] The same query test suite runs against `LocalStorage` (and later `BasinStorage`)

**Done means:** whole flow works offline on the laptop with `LOG_STORAGE=local`.

## Phase 3: Dashboard UI
**Agent:** ui-builder. Branches: `feature/ui-shell`, `feature/ui-auth`, `feature/ui-projects`,
`feature/ui-connect`, `feature/ui-live-tail`, `feature/ui-states`.

Match `docs/design/` (layout, tokens, type scale 11/12/13/15/24, radii 6/10, light + dark).
- [ ] Sign in, sign out, invite teammate
- [ ] Projects list with live/waiting status and team table
- [ ] Connect a source: name → platform → snippet with token shown once + copy → "listening" check
- [ ] Live tail: search + field:value filters, time range, histogram (click to zoom, legend toggles level),
      expandable rows with Filter / Chart per field, keyboard j/k/Enter and `/`, pause, wrap lines,
      honest freshness ("Data through HH:MM:SS UTC · ~60s ingest lag" in prod)
- [ ] Empty, loading, query-too-large, and ingestion-problem states
- [ ] Theme toggle remembered across pages

**Done means:** Playwright covers every bullet above against real `wrangler dev`, in both themes.

## Phase 4: Charts and dashboards
**Agents:** backend (API) then ui-builder. Branch: `feature/charts`.

- [ ] Saved views (name + filter), listed in the sidebar
- [ ] Chart builder drawer: filter, field, measure (count, count over time, avg, p95), viz (bar, pie, line, number)
- [ ] Pin chart to a dashboard; dashboards CRUD; chart tile menu (edit, duplicate, remove)
- [ ] Export CSV for any chart or the log table

**Done means:** build a chart → pin → reload → it's there with correct numbers (verified against the query API).

## Phase 5: Basin in production
**Agent:** backend. Branch: `feature/basin`. **Needs owner:** Workers Paid plan, `wrangler login`.
**Ask first** before creating any Cloudflare resource or deploying.

- [ ] Verify current Basin docs (Pipelines streams/binding, Catalog sink, Basin SQL query API, limits)
- [ ] `BasinStorage.write`: Pipelines stream binding; `query`/`histogram`: Basin SQL with the same filter → SQL builder
- [ ] Event schema for the stream matches `docs/ARCHITECTURE.md`; roll interval 60s
- [ ] `scripts/setup-basin.js`: creates bucket, catalog, stream, sink, pipeline via wrangler (idempotent)
- [ ] Deploy to a **staging** Worker on the owner's account; shared query test suite passes against Basin
- [ ] UI shows ingest lag honestly; document every Basin limitation found in `docs/PLAN.md` and README

**Done means:** a real event sent to staging shows up in live tail via Basin SQL (~60s), and charts work on Basin.

## Phase 6: Security review (runs after every feature branch, plus one full pass here)
**Agent:** security-reviewer.

- [ ] Full-repo review against the checklist in `.claude/agents/security-reviewer.md`
- [ ] All critical and high findings fixed and re-reviewed
- [ ] `SECURITY.md` with how to report a vulnerability

**Done means:** no open critical/high findings.

## Phase 7: Landing page and install
**Agent:** landing-page (+ backend for the installer). Branches: `feature/landing`, `feature/installer`.

- [ ] Landing page (static, served at `/` when signed out or as a separate Pages site; decide with owner)
- [ ] `npx create-open-logs`: clone → `wrangler login` → create D1 + Basin resources → set `ADMIN_PASSWORD` → deploy
- [ ] "Deploy to Cloudflare" button in README; document clearly if it can't provision Basin
- [ ] README: what it is, screenshots, install in one command, sending logs (curl, JS, Python, Go), limits, costs
- [ ] SDK snippets work as shown (tested)

**Done means:** a fresh Cloudflare account can go from zero to seeing logs using only the README.

## Phase 8: Release
**Ask first** before merging to `main`.

- [ ] `develop` → `main`, tag `v0.1.0`, GitHub release notes
- [ ] Live demo deployed (owner's account), link in README
- [ ] Short build-in-public write-up draft for the owner's blog/X

---

## Known constraints (keep updated)
- Basin Pipelines needs the Workers Paid plan ($5/month minimum).
- Iceberg sink roll interval minimum is 60s, so prod data is ~60s+ behind. The live tail is "near real time".
- Basin SQL is read-only and can time out on heavy queries: always time-bound, select columns, use LIMIT.
- Whether Basin runs inside `wrangler dev` is unconfirmed; local dev uses `LocalStorage` regardless.
