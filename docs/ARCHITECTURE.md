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
                                         D1 (app data)   LogStorage adapter
                                                         ├─ local: D1 `logs` table
                                                         └─ basin: Pipelines stream ─▶ Iceberg table (R2)
                                                                     Basin SQL ◀── queries
```

One Worker, one deploy. Single team per deployment (no multi-tenancy across customers;
everyone who signs in belongs to the same team and sees every project).

## Stack and dependencies
Allowed without asking: `wrangler`, `vitest`, `@cloudflare/vitest-plugin` (the renamed `vitest-pool-workers`),
`@playwright/test`, `@biomejs/biome`, and (owner-approved 2026-10-30) `hono` for the Worker and `react`,
`react-dom`, `react-router`, `@tanstack/react-query`, `vite`, `@vitejs/plugin-react` for the UI. Anything else: ask first.
Prefer Web Crypto and platform APIs over libraries.

## Data model (D1)

| Table | Key columns |
|---|---|
| `users` | id, email (unique), name, password_hash, password_salt, role (`owner\|admin\|member`), created_at, last_active_at |
| `sessions` | id (random, hashed in DB), user_id, expires_at, created_at |
| `invites` | id, email, role, token_hash, expires_at, accepted_at |
| `projects` | id, name (unique), created_at |
| `sources` | id, project_id, name, token_hash (SHA-256), token_prefix, created_at, last_event_at |
| `saved_views` | id, project_id, name, filter_json, created_by |
| `dashboards` | id, project_id, name |
| `charts` | id, dashboard_id, title, filter_json, field, measure, viz, position, size |
| `logs` (local only) | id, ts (ms), project_id, source, level, message, fields_json |

Passwords: PBKDF2-SHA256 via Web Crypto with a per-user salt (check the Workers iteration limit).
Source tokens: `ol_` + 32 random bytes base64url. Shown once. Store SHA-256 hash + first 8 chars as prefix.

## Event schema (what gets stored, both adapters)

```json
{ "ts": 1793356800123, "project_id": "prj_…", "source": "api",
  "level": "error", "message": "payment failed", "fields": "{\"order_id\":4821}" }
```
- `ts` from the client if valid (within ±24h), else server time.
- `level` normalised to `debug|info|warn|error|fatal`.
- `project_id` and `source` are **always set by the server** from the token, never from the body.
- `fields` = every other JSON key, serialised. Size caps per event and per batch (Pipelines max 5 MB/request).

## Query model
Clients send a structured filter, never SQL:
```json
{ "project_id": "prj_…", "from": 1793355900000, "to": 1793356800000,
  "where": [ {"field":"level","op":"in","value":["error","warn"]},
             {"field":"fields.status","op":"=","value":500},
             {"text":"payment failed"} ],
  "limit": 100, "cursor": null }
```
A single `buildSql(filter, dialect)` turns it into **parameterised** SQL for D1 or Basin SQL.
Columns are whitelisted; `fields.*` keys must match `^[a-zA-Z0-9_.]{1,64}$`; values are always bound parameters.
Time range is mandatory and capped (e.g. 7 days); limit capped (e.g. 500).

## API (full contract lives in `docs/API.md`, owned by the backend agent)
- `POST /v1/logs`: ingest
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- `GET|POST /api/users`, `POST /api/invites`, `POST /api/invites/:token/accept`
- `GET|POST /api/projects`, `PATCH|DELETE /api/projects/:id`
- `GET|POST /api/projects/:id/sources`, `POST /api/sources/:id/regenerate`, `DELETE /api/sources/:id`
- `POST /api/query`, `POST /api/histogram`, `POST /api/aggregate` (charts)
- `GET|POST /api/projects/:id/views`, dashboards and charts CRUD
- `GET /api/status`: storage mode and, in basin mode, newest event time (for honest freshness)

## Basin (production)
- **Basin Pipelines**: stream (durable buffer, Worker binding `send()`), pipeline (SQL transform), sink (Iceberg table in Basin Catalog). Roll interval: 60s (minimum for Iceberg sinks; default 300s).
- **Basin Catalog**: Iceberg REST catalog; enable compaction.
- **Basin SQL**: read-only distributed query engine over the catalog. Supports WHERE, GROUP BY, ORDER BY, LIMIT, JSON functions, approx aggregates. Heavy queries can time out.
- Limits: Workers Paid plan required; 20 streams/pipelines/sinks per account; 5 MB per ingest request.

Docs to verify before coding (they're new, don't trust memory):
- https://developers.cloudflare.com/basin-pipelines/
- https://developers.cloudflare.com/basin-pipelines/streams/writing-to-streams/
- https://developers.cloudflare.com/basin-pipelines/sinks/available-sinks/r2-data-catalog/
- https://developers.cloudflare.com/basin-pipelines/platform/limits/
- https://developers.cloudflare.com/basin-sql/
- https://developers.cloudflare.com/basin-sql/reference/limitations-best-practices/
- https://blog.cloudflare.com/cloudflare-basin/

## Security baseline (security-reviewer enforces)
- Log content is attacker-controlled: render as text only (`textContent`), never `innerHTML`. Strict CSP.
- No raw SQL from clients; parameterised queries only.
- Cookies HttpOnly + Secure + SameSite=Lax; check `Origin` on state-changing requests.
- Constant-time comparison for token and password checks.
- Rate limit sign-in and ingest. Generic sign-in errors.
- Secrets only via `wrangler secret` / `.dev.vars` (gitignored).
