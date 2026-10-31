# Open Logs: architecture

## Shape

```
  Customer apps ──POST /v1/logs (Bearer source token)──┐
                                                        ▼
                                          ┌──────────────────────────┐
  Browser (team) ──cookie session─────────▶  Open Logs Worker         │
                                          │  /v1/logs   ingest        │
                                          │  /api/*     app API       │
                                          │  /*         React app     │
                                          └──────┬───────────┬───────┘
                                                 │           │
                                         D1 (app data)   BasinStorage
                                                         ├─ write: Pipelines stream ─▶ pipeline ─▶ Iceberg sink
                                                         │                                  ▼
                                                         │                    Iceberg table in R2 (Basin Catalog)
                                                         └─ read:  Basin SQL (HTTP) ◀──────────┘
```

One Worker, one deploy. Single team per deployment (no multi-tenancy across customers;
everyone who signs in belongs to the same team and sees every project).

Logs live only in Basin. D1 holds only app data. There is no local mode and no D1 `logs` table:
Basin has no local version, so Open Logs runs only on Cloudflare (Workers Paid plan).

## Stack and dependencies
Allowed without asking: `wrangler`, `vitest`, `@cloudflare/vitest-plugin` (the renamed `vitest-pool-workers`),
`@playwright/test`, `@biomejs/biome`, and (owner-approved 2026-10-30) `hono` for the Worker and `react`,
`react-dom`, `react-router`, `@tanstack/react-query`, `vite`, `@vitejs/plugin-react` for the UI. Anything else: ask first.
Prefer Web Crypto and platform APIs over libraries.

## Data flow

**Ingest** (`src/ingest/handler.js`):
1. The bearer token is hashed (SHA-256) and looked up in D1 `sources`. Unknown token → 401, counted on the
   source whose current or previous token prefix matches (so a stale token shows as an ingestion problem).
2. Per-token rate limit, size limits, JSON parse.
3. Each event is normalised (`src/ingest/normalize.js`). The server stamps `project_id`, `source_id` and
   `source` from the token; body keys with those names are dropped.
4. `env.LOG_STREAM.send(events)` writes them to the Pipelines stream. The pipeline copies the stream into the
   Iceberg sink, which writes files to R2 every 60 seconds and commits them to the Basin Catalog.
   Events become searchable about 1.5 to 3.5 minutes after ingest (measured on staging).

**Query** (`src/routes/query.js`):
1. The body is parsed and validated as a filter (`src/query/filter.js`).
2. `source` clauses are rewritten from names to source ids (`src/query/sources.js`).
3. `src/query/sql.js` builds Basin SQL from the filter. `src/storage/basin.js` sends it to the Basin SQL HTTP API
   with the `BASIN_SQL_TOKEN` secret.
4. Rows are shaped into API responses (`src/storage/shape.js`), and source ids are turned back into
   today's source names.

## Sources: `source_id` and `source`

Every log carries two source columns:
- `source_id`: the source's permanent id (`src_…`). It never changes.
- `source`: the source's name when the log arrived.

Filters and charts use the id. People filter by name (`source:api`); the server maps names to ids for the
query and maps ids back to today's names in the response. So:
- Renaming a source keeps its history under the new name.
- A new source that reuses a deleted source's name never shows the old logs.
- Logs from a deleted source keep the name they arrived with (charts label them "deleted source").

## Data model (D1, app data only)

| Table | Key columns |
|---|---|
| `users` | id, email (unique), name, password_hash, password_salt, role (`owner\|admin\|member`), created_at, last_active_at |
| `sessions` | id (SHA-256 of the session token), user_id, expires_at, created_at |
| `invites` | id, email, role, token_hash, created_by, created_at, expires_at, accepted_at |
| `settings` | key, value (e.g. `team_name`; falls back to the `TEAM_NAME` var) |
| `projects` | id, name (unique), created_at |
| `sources` | id, project_id, name, token_hash (SHA-256), token_prefix, prev_token_prefix, created_at, last_event_at, rejected_count, last_rejected_at |
| `saved_views` | id, project_id, name, filter_json, created_by, created_at |
| `dashboards` | id, project_id, name, created_at |
| `charts` | id, dashboard_id, title, filter_json, field, measure, viz, position, size, created_at |

Schema: `migrations/0001_init.sql`. After the first release it is frozen and changes are additive
migrations only (see Release rules in `CLAUDE.md`).

Passwords: PBKDF2-SHA256 via Web Crypto with a per-user salt.
Source tokens: `ol_` + 32 random bytes base64url. Shown once. Store SHA-256 hash + first 8 chars as prefix.

## Event schema (Basin stream, `basin/stream-schema.json`)

```json
{ "id": "…", "ts": 1793356800123, "project_id": "prj_…", "source_id": "src_…", "source": "api",
  "level": "error", "message": "payment failed", "fields": "{\"order_id\":4821}" }
```
- All columns are required strings except `ts` (int64, ms).
- `ts` from the client if valid (within ±24h), else server time.
- `level` normalised to `debug|info|warn|error|fatal`.
- `project_id`, `source_id` and `source` are **always set by the server** from the token, never from the body.
- `fields` = every other JSON key, serialised. Size caps per event and per batch (Pipelines max 5 MB/request).
- The columns are fixed once users have installed Open Logs. New data goes into `fields`.

## Storage

One adapter: `BasinStorage` (`src/storage/basin.js`), returned by `getStorage()` in `src/storage/index.js`.
It implements `write`, `query`, `histogram`, `aggregate`, `newest`, `overview` and `deleteProject`
(a no-op: Basin SQL is read-only, so a deleted project's files stay in R2).

## Query model
Clients send a structured filter, never SQL:
```json
{ "project_id": "prj_…", "from": 1793355900000, "to": 1793356800000,
  "where": [ {"field":"level","op":"in","value":["error","warn"]},
             {"field":"fields.status","op":"=","value":500},
             {"text":"payment failed"} ],
  "limit": 100, "cursor": null }
```
`src/query/sql.js` turns it into Basin SQL. Columns are whitelisted (`level`, `source`, `message`);
`fields.*` keys must match `^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$`.
Basin SQL has no bound parameters, so every value goes through one function (`sqlLiteral`) that renders it as an
escaped literal: quotes doubled, NUL removed, backslashes as `chr(92)`, numbers must be finite.
Time range is mandatory and capped at 7 days; limit capped at 500.

## Install layout

Each install is named (`--name`, or asked for; Enter means `open-logs`) and lives in `.open-logs/` in the clone (gitignored):
- `.open-logs/<name>.jsonc`: the generated wrangler config. `scripts/lib.js` builds it from `wrangler.jsonc`
  (a template with no account ids) plus the install's own D1 id, stream id, bucket and account.
- `.open-logs/<name>.json`: the Cloudflare resources the install created (account, URL, bucket, stream,
  sink, pipeline, D1, owner email). Update, rollback and uninstall read it.

Scripts (`scripts/`):
- `setup.js` (`npm run setup`): creates the R2 bucket, Basin Catalog, stream, sink (60s roll), pipeline and D1;
  writes both files; applies migrations; builds and deploys; sets `ADMIN_PASSWORD` and `BASIN_SQL_TOKEN`;
  sends a test log and waits until Basin can search it (`check.js`).
- `update.js` (`npm run update`): checks out the newest release tag (or `--to`), reinstalls packages,
  regenerates the config, applies only new D1 migrations, builds and deploys, then runs the log check.
- `rollback.js` (`npm run rollback`): `wrangler rollback` to the previous Worker version. D1 is not rolled
  back; it prints the D1 Time Travel restore command.
- `uninstall.js` (`npm run uninstall`): removes the Worker and secrets, pipeline, sink, stream, Basin Catalog,
  every file in the bucket (Cloudflare API), the bucket and D1. The API token must be deleted by hand.
- `staging.js` (`npm run deploy:staging`, `npm run staging:reset`): deploys to the install you name (the staging one).

Tests run against `wrangler.jsonc` directly (the template), with a local D1. They cover app data and SQL
building; they do not reach Basin.

## API (full contract lives in `docs/API.md`)
- `POST /v1/logs`: ingest
- `GET /api/health`, `GET /api/config` (public)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `POST /api/me/password`
- `GET|PATCH /api/settings`
- `GET /api/users`, `DELETE /api/users/:id`, `POST /api/invites`, `GET /api/invites/:token`, `POST /api/invites/:token/accept`
- `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/:id`
- `GET|POST /api/projects/:id/sources`, `GET|PATCH|DELETE /api/sources/:id`, `POST /api/sources/:id/regenerate`
- `POST /api/query`, `POST /api/histogram`, `POST /api/aggregate` (charts)
- `GET|POST /api/projects/:id/views`, `DELETE /api/views/:id`, dashboards and charts CRUD
- `GET /api/status`: ingest lag and newest event time (for honest freshness)

## Basin
- **Basin Pipelines**: stream (durable buffer, Worker binding `send()`), pipeline (SQL `INSERT INTO sink SELECT * FROM stream`), sink (Iceberg table in Basin Catalog). Roll interval: 60s (minimum for Iceberg sinks; default 300s). The CLI sink type is `r2-data-catalog`.
- **Basin Catalog**: Iceberg REST catalog on the R2 bucket. Namespace `open_logs`, table `events`; the sink creates them on its first write.
- **Basin SQL**: read-only distributed query engine over the catalog. Supports WHERE, GROUP BY, ORDER BY, LIMIT, JSON functions, approx aggregates. Heavy queries can time out.
- Limits: Workers Paid plan required; 20 streams/pipelines/sinks per account; 5 MB per ingest request.
- One Cloudflare API token (R2 Admin Read & Write, which includes Basin SQL Read) is used as the sink's catalog token and as `BASIN_SQL_TOKEN`.

Docs to verify before coding (they're new, don't trust memory):
- https://developers.cloudflare.com/basin-pipelines/
- https://developers.cloudflare.com/basin-pipelines/streams/writing-to-streams/
- https://developers.cloudflare.com/basin-pipelines/sinks/available-sinks/r2-data-catalog/
- https://developers.cloudflare.com/basin-pipelines/platform/limits/
- https://developers.cloudflare.com/basin-sql/
- https://developers.cloudflare.com/basin-sql/reference/limitations-best-practices/
- https://blog.cloudflare.com/cloudflare-basin/

## Security baseline (checked in every security review)
- Log content is attacker-controlled: render as text only (React text nodes, never `dangerouslySetInnerHTML`). Strict CSP.
- No raw SQL from clients. D1 queries use bound parameters; Basin SQL values go through `sqlLiteral` only.
- Cookies HttpOnly + Secure + SameSite=Lax; check `Origin` on state-changing requests.
- Constant-time comparison for token and password checks.
- Rate limit sign-in and ingest. Generic sign-in errors.
- Secrets only via `wrangler secret`. `.open-logs/` and `.dev.vars` are gitignored.
- Recommend Cloudflare Access in front of the Worker, with a bypass for `/v1/logs`.
