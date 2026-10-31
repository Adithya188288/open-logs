# Open Logs: build plan

Each phase is one or more feature branches off `develop` (see Git Flow in `CLAUDE.md`).
Tick boxes as they're done. A phase is done only when every box is ticked.
Phases 0–4 were first built to run locally. Since 2026-10-31 logs live only in Basin (see Progress notes),
so running Open Logs needs the owner's Cloudflare account on the Workers Paid plan.
2026-10-31: all tests, CI and test packages were removed (owner decision). Tests will be rebuilt from scratch, one at a time, with the owner.

---

## Phase 0: Repo and tooling
**Agent:** lead. **Ask first** before creating the GitHub repo or installing global tools.

- [x] Confirm `gh auth status` and `wrangler whoami` work (owner logs in if not)
- [x] `git init`, initial commit on `main`, create `develop` from `main`
- [ ] Create public GitHub repo `open-logs`, push `main` and `develop`, set default branch `develop`
- [ ] Protect `main` and `develop` (PRs only) if the owner agrees
- [x] `package.json`, `wrangler.jsonc`, `.gitignore` (incl. `.dev.vars`, `.wrangler/`, `node_modules/`)
- [x] Vitest + `@cloudflare/vitest-pool-workers` set up, one passing smoke test
      (that package is now published as `@cloudflare/vitest-plugin`, same project renamed; we use it)
- [x] Playwright set up, one passing smoke test against `wrangler dev`
- [x] GitHub Actions: lint + unit + e2e on every PR (workflow written; first run happens once the repo is on GitHub)
- [x] `README.md` stub, `LICENSE` (MIT), `docs/API.md` stub

**Done means:** `npm test` and `npm run test:e2e` pass locally and in CI; `npm run dev` serves a hello page.
(Since 2026-10-31 there is no local server: `npm run dev` only prints that Open Logs runs on Cloudflare.
Vitest, Playwright and the CI workflow were removed the same day; tests will be rebuilt later.)

## Phase 1: Backend core
**Agent:** backend. Branches: `feature/db-schema`, `feature/auth`, `feature/projects-sources`, `feature/ingest`, `feature/query-api`.

- [x] D1 migrations for every app table in `docs/ARCHITECTURE.md`
- [x] Auth: first sign-in with `ADMIN_PASSWORD` creates the owner; email + password sign-in;
      sessions in D1 with an HttpOnly, Secure, SameSite=Lax cookie; sign-out
- [x] Users: owner invites teammates (email + role), invite link sets password, roles `owner|admin|member`
- [x] Projects: create, list, rename, delete
- [x] Sources: create inside a project, returns token **once**; store only a SHA-256 hash + short prefix;
      regenerate token; delete
- [x] Ingest `POST /v1/logs`: bearer token → source + project, accepts one event or an array,
      validates and normalises, stamps `project_id`/`source` **server side**, size limits, per-token rate limit
- [x] Query API: structured filter (never raw SQL from clients), mandatory time range, limit, cursor paging;
      histogram endpoint (counts by bucket and level)
- [x] `docs/API.md` kept current with every endpoint, request, response, and error

**Done means:** integration tests cover: sign in → create project → create source → ingest → query it back;
bad token → 401; oversized batch → 413; no session → 401 on app routes.

## Phase 2: Storage adapter (local first)
**Agent:** backend. Branch: `feature/storage-adapter`.

**Superseded 2026-10-31** (`feature/basin-only`): `LocalStorage`, the D1 `logs` table and the `LOG_STORAGE`
switch are removed. `BasinStorage` is the only adapter. The boxes below record what was built then.

- [x] `LogStorage` interface: `write(events)`, `query(filter)`, `histogram(filter)`
- [x] `LocalStorage`: D1 `logs` table, JSON fields via `json_extract`, indexes on (project_id, ts)
- [x] Adapter chosen by env var `LOG_STORAGE=local|basin`
- [x] The same query test suite runs against `LocalStorage` (and later `BasinStorage`)

**Done means:** whole flow works offline on the laptop with `LOG_STORAGE=local`.

## Phase 3: Dashboard UI
**Agent:** ui-builder. Branches: `feature/ui-shell`, `feature/ui-auth`, `feature/ui-projects`,
`feature/ui-connect`, `feature/ui-live-tail`, `feature/ui-states`.

Match `docs/design/` (layout, tokens, type scale 11/12/13/15/24, radii 6/10, light + dark).
- [x] Sign in, sign out, invite teammate
- [x] Projects list with live/waiting status and team table
- [x] Connect a source: name → platform → snippet with token shown once + copy → "listening" check
- [x] Live tail: search + field:value filters, time range, histogram (click to zoom, legend toggles level),
      expandable rows with Filter / Chart per field, keyboard j/k/Enter and `/`, pause, wrap lines,
      honest freshness ("Data through HH:MM:SS UTC · ~60s ingest lag" in prod)
- [x] Empty, loading, query-too-large, and ingestion-problem states
- [x] Theme toggle remembered across pages

**Done means:** Playwright covers every bullet above against real `wrangler dev`, in both themes.
(2026-10-31: the Playwright suite was removed; browser tests will be rebuilt later.)

## Phase 4: Charts and dashboards
**Agents:** backend (API) then ui-builder. Branch: `feature/charts`.

- [x] Saved views (name + filter), listed in the sidebar
- [x] Chart builder drawer: filter, field, measure (count, count over time, avg, p95), viz (bar, pie, line, number)
- [x] Pin chart to a dashboard; dashboards CRUD; chart tile menu (edit, duplicate, remove)
- [x] Export CSV for any chart or the log table

**Done means:** build a chart → pin → reload → it's there with correct numbers (verified against the query API).

## Phase 5: Basin in production
**Agent:** backend. Branch: `feature/basin`. **Needs owner:** Workers Paid plan, `wrangler login`.
**Ask first** before creating any Cloudflare resource or deploying.

- [x] Verify current Basin docs (Pipelines streams/binding, Catalog sink, Basin SQL query API, limits)
      (checked 2026-10-30; findings under Known constraints)
- [x] `BasinStorage.write`: Pipelines stream binding; `query`/`histogram`: Basin SQL with the same filter → SQL builder
      (unit-tested with a mocked SQL API; **not yet run against real Basin**)
- [x] Event schema for the stream matches `docs/ARCHITECTURE.md`; roll interval 60s (`basin/stream-schema.json`, plus an `id` column)
- [x] `scripts/setup-basin.js`: creates bucket, catalog, stream, sink, pipeline via wrangler (idempotent)
      (2026-10-31: replaced by `scripts/setup.js`, which creates Basin and D1 and deploys in one go)
- [x] Deploy to a **staging** Worker on the owner's account; shared query test suite passes against Basin
      (2026-10-30: `open-logs-staging` on workers.dev. 10 events sent → in `open_logs.events` in under 2 min.
      The app's own queries all pass on real Basin: filters, nested JSON, number compares, free-text search,
      LIKE escaping, injection probe, histogram, p95, grouped series, freshness. Live tail, search and the
      Overview dashboard show correct numbers in the UI.)
- [ ] UI shows ingest lag honestly; document every Basin limitation found in `docs/PLAN.md` and README
      (README and Known constraints updated 2026-10-31; the UI freshness text still to re-check on staging)

**Done means:** a real event sent to staging shows up in live tail via Basin SQL (~60s), and charts work on Basin.

## Phase 6: Security review (runs after every feature branch, plus one full pass here)
**Agent:** security-reviewer.

- [x] Full-repo review against the checklist in `.claude/agents/security-reviewer.md`
      (that file was missing from the kit; reviewed against the ARCHITECTURE.md security baseline. Verdict PASS)
- [x] All critical and high findings fixed and re-reviewed (none critical/high; mediums fixed: Basin literals
      immune to backslash escaping, per-IP sign-in limit, open redirect, invites cancelled with their sender)
- [x] `SECURITY.md` with how to report a vulnerability

**Done means:** no open critical/high findings.

## Phase 7: Landing page and install
**Agent:** landing-page (+ backend for the installer). Branches: `feature/landing`, `feature/installer`.

- [ ] Landing page (static, served at `/` when signed out or as a separate Pages site; decide with owner)
      (built in `site/` as a standalone Pages site; serving it at `/` is still the owner's call)
- [ ] ~~`npx create-open-logs`~~ → `git clone` + `npm run setup`: `wrangler login` → create Basin + D1 →
      deploy → set `ADMIN_PASSWORD` and `BASIN_SQL_TOKEN` → app is up
      (2026-10-31: `create-open-logs/` and `scripts/install.js` removed; `scripts/setup.js` replaces them)
- [ ] `npm run update`, `npm run rollback`, `npm run uninstall` (written 2026-10-31, `scripts/`)
- [x] ~~"Deploy to Cloudflare" button in README~~ dropped 2026-10-31: it cannot create Basin resources,
      and Open Logs no longer works without them
- [x] README: what it is, screenshots, install in one command, sending logs (curl, JS, Python, Go), limits, costs
- [x] SDK snippets work as shown (tested: e2e runs JS, Python, curl; Go on CI)

**Done means:** a fresh Cloudflare account can go from zero to seeing logs using only the README.

## Phase 8: Release
**Ask first** before merging to `main`.

- [ ] `develop` → `main`, tag `v0.1.0`, GitHub release notes
- [ ] Live demo deployed (owner's account), link in README
- [ ] Short build-in-public write-up draft for the owner's blog/X

---

## Progress notes
- 2026-10-30: Phases 0–4 built locally on feature branches merged into a local `develop`
  (all tests green at the time; the suites are being restructured on `feature/basin-only`, so the counts
  from that day no longer apply). Not done yet: creating the GitHub
  repo, pushing, branch protection and the first CI run. Those wait for the owner's go-ahead.
- Rate limiting uses the Workers Rate Limiting binding (`LOGIN_LIMITER`, `INGEST_LIMITER`): no extra
  dependency, works in `wrangler dev` and tests. Its counters are per Cloudflare location, so limits are
  approximate, not global.
- Owner can remove teammates (`DELETE /api/users/:id`). Not in the original plan; added because without
  it there is no way to revoke access.
- 2026-10-31, `feature/basin-only`:
  - **Logs live only in Basin.** D1 holds only app data. Removed: `src/storage/local.js`, the D1 `logs` table,
    the `LOG_STORAGE` switch, `env.staging` in `wrangler.jsonc`. There is no local run: `npm run dev` only
    prints that Open Logs runs on Cloudflare. Workers Paid is required.
  - **`source_id` on every log** (new column in `basin/stream-schema.json`). Filters and charts use the id;
    the API shows today's name (`src/query/sources.js`). Renaming a source keeps its history; a new source
    reusing a deleted source's name never shows the old logs. Sources can be renamed (`PATCH /api/sources/:id`).
  - **Install**: `git clone` + `npm run setup` (`scripts/setup.js`). One Cloudflare API token (R2 Admin
    Read & Write) for the sink and `BASIN_SQL_TOKEN`. Each install's config and resource ids go in
    `.open-logs/` (gitignored); `wrangler.jsonc` is now a template with no account ids.
    `create-open-logs/`, `scripts/install.js`, `scripts/setup-basin.js` and the Deploy button are gone.
  - **Maintain**: `npm run update` (newest release tag, new migrations only, deploy, app-is-up check),
    `npm run rollback` (previous Worker version; D1 Time Travel explained), `npm run uninstall`
    (removes everything, including the bucket's files; the API token is deleted by hand).
  - **Staging**: an ordinary install, picked by name like every command. `npm run deploy:staging` deploys the current
    branch; `npm run staging:reset` (from `develop` only) wipes its D1 and redeploys `develop`.
  - **Tests**: all tests, CI and test packages removed (owner decision). To be rebuilt one at a time.
  - Release rules added to `CLAUDE.md` (additive migrations after the first release, fixed Basin columns,
    every release tested as an update from the previous one).
  - Still to verify on a throwaway install: setup, update, rollback and uninstall each end to end.

## Known constraints (keep updated)
- Remaining low findings from the security pass (accepted for v1): a known token prefix lets someone inflate a
  source's rejection counter (rate limited per IP); members can regenerate source tokens; the per-event size
  check counts characters, not bytes (requests are still byte-capped at 5 MB).
- Basin Pipelines needs the Workers Paid plan ($5/month minimum).
- Iceberg sink roll interval minimum is 60s, so prod data is ~60s+ behind. The live tail is "near real time".
- Basin SQL is read-only and can time out on heavy queries: always time-bound, select columns, use LIMIT.
- Basin has no local version, so Open Logs has no local run. Changes are checked on staging.
- **Basin SQL has no bound parameters** (the HTTP API takes one `query` string). The Basin dialect inlines
  values as SQL literals (`'…'` with quotes doubled, NUL stripped, numbers must be finite). Values only ever
  come from a validated filter; table names are checked against `^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$`.
- Verified on real Basin (staging, 2026-10-30):
  - Responses are `{ result: { schema, rows: [{…}], metrics: { bytes_scanned, files_scanned } }, success }`.
  - Backslash is an ordinary character inside string literals; quotes are escaped by doubling.
  - `LIKE … ESCAPE` only accepts backslash (`ESCAPE '!'` is rejected).
  - Nested JSON paths work as variadic args: `json_get_float(fields, 'http', 'status')`.
  - The sink creates the namespace and table on its first write, not at sink creation.
  - Sink type in the CLI is `r2-data-catalog` (docs say `basin-catalog`); `--catalog-token` is required and
    needs R2 **Admin** Read & Write. Sinks and new pipelines cannot be edited, only deleted and recreated.
  - An R2 Admin Read & Write token can also run Basin SQL queries.
- Freshness: on staging, events became searchable 1.5–3.5 minutes after ingest. The status endpoint
  reports a 3-minute lag.
- Latency: Basin queries take ~1–2 s each, so the first live tail load takes a few seconds. A dashboard load
  runs ~25 queries (each billed at the 10 MB minimum, ~250 MB per load).
- p95 on Basin uses `approx_percentile_cont` (T-Digest), so it is approximate.
- Free-text search on Basin uses `lower(x) LIKE lower('%…%')` (no ILIKE). Window functions and
  PERCENTILE_CONT are budget-gated; queries that would scan too much return 400 → shown as "query too large".
- Deleting a project does not delete its Basin data (Basin SQL is read-only); files stay in R2.
  `npm run uninstall` deletes every file in the bucket through the Cloudflare API.
- Scripts cannot delete Cloudflare API tokens. Uninstall tells the user to delete the token by hand.
- Ingest on Basin: invalid events on a structured stream are dropped, not rejected, so the Worker validates
  and normalises every event before `send()`.
