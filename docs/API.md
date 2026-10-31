# Open Logs API

One Worker serves everything:

| Path | Auth | What |
|---|---|---|
| `POST /v1/logs` | `Authorization: Bearer <source token>` | Ingest |
| `/api/*` | `ol_session` cookie | App API used by the dashboard |
| everything else | none | Static dashboard UI |

## Conventions

- Bodies are JSON. Times are unix milliseconds (UTC).
- Errors always look like this, with a stable `code`:
  ```json
  { "error": { "code": "invalid_field", "message": "name is invalid", "field": "name" } }
  ```
- Every state-changing `/api` request (`POST`, `PATCH`, `DELETE`) must send an `Origin` header equal to
  the app's own origin, otherwise `403 bad_origin`. Browsers do this automatically.
- `/api` routes need a session unless marked **public**. No session → `401 unauthorized`.
- Roles: `owner` > `admin` > `member`. A route marked *admin* needs admin or owner.

| Status | Codes |
|---|---|
| 400 | `invalid_json`, `invalid_body`, `invalid_field`, `invalid_filter`, `invalid_event`, `empty_batch`, `cannot_remove_self`, `wrong_password` |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_token` |
| 403 | `forbidden`, `bad_origin` |
| 404 | `not_found` |
| 405 | `method_not_allowed` (ingest only accepts `POST` and `OPTIONS`) |
| 409 | `conflict`, `already_member` |
| 413 | `payload_too_large`, `event_too_large`, `too_many_events` |
| 422 | `query_too_large` (includes a `hint`) |
| 429 | `rate_limited` |
| 500 | `internal` |

---

## Ingest

### `POST /v1/logs`

Send one event object or an array of them.

```bash
curl -X POST https://logs.example.com/v1/logs \
  -H "Authorization: Bearer $LOGS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"level":"error","message":"payment failed","order_id":4821}]'
```

Response `202`: `{ "accepted": 1 }`

How each event is read:

| Stored as | Taken from (first present wins) | Notes |
|---|---|---|
| `ts` | `ts`, `timestamp`, `dt` | ms, seconds or ISO 8601. Outside ±24h of server time → server time. |
| `level` | `level`, `severity` | Normalised to `debug\|info\|warn\|error\|fatal`. Pino numbers (10–60) work. Unknown → `info`. |
| `message` | `message`, `msg` | Non-strings are JSON-encoded. |
| `project_id`, `source_id`, `source` | the token | Always set by the server. Body keys with these names are dropped. `source_id` is the source's permanent id; `source` is its name at ingest. |
| `fields` | every other key | Kept as JSON; filterable and chartable as `fields.<key>` (nested: `fields.http.status`). |

Limits: 5 MB per request, 10,000 events per request, 256 KB per event, 1,200 requests per minute per
token (batch your events). CORS is open (`*`) because auth is the bearer token, not a cookie.

Errors: `401 invalid_token`, `400 invalid_json|empty_batch|invalid_event` (with `index`),
`413 payload_too_large|too_many_events|event_too_large` (with `index`), `429 rate_limited`.

Accepted events are written to the Basin Pipelines stream. They become searchable about 1 to 3 minutes later.

Requests made with a regenerated (old) token are counted on that source
(`rejected_count`, `last_rejected_at`) so the dashboard can show an ingestion problem.

---

## Health and config

### `GET /api/health` (public)
`200 { "ok": true }`. Used by `npm run update` when the log check is skipped.

### `GET /api/config` (public)
`200 { "team_name": "Acme" }`: used by the sign-in page.

---

## Auth and team

### `POST /api/auth/login` (public)
`{ "email": "you@acme.dev", "password": "…" }` → `200 { "user": User }` and sets the session cookie
(`HttpOnly; Secure; SameSite=Lax`, 30 days).

On a fresh install (no users yet) the password must equal the `ADMIN_PASSWORD` secret; that sign-in
creates the **owner** with the given email. Wrong credentials always return
`401 invalid_credentials` "Invalid email or password". Rate limited to 10 attempts per minute per IP + email.

### `POST /api/auth/logout`
Deletes the session. `200 { "ok": true }` and clears the cookie.

### `GET /api/me`
`200 { "user": User, "team_name": "Acme" }`

`User = { id, email, name, role, created_at, last_active_at }`

### `POST /api/me/password`
`{ "current_password": "…", "new_password": "8 to 256 chars" }` → `200 { "ok": true }`.
Wrong current password → `400 wrong_password`. Signs out your other sessions; this one stays signed in.
Rate limited to 10 attempts per minute per user.

### `GET /api/settings`
`200 { "settings": { "team_name": "Acme" } }`

### `PATCH /api/settings` (admin)
`{ "team_name": "Acme" }` (1–60 chars) → `200 { "settings": { "team_name": "Acme" } }`.
Stored in D1; until set, the team name comes from the `TEAM_NAME` Worker var.

### `GET /api/users`
`200 { "users": User[], "invites": [{ id, email, role, created_at, expires_at }] }` (pending invites only).

### `DELETE /api/users/:id` (owner)
Removes a teammate and all their sessions. You can't remove yourself (`400 cannot_remove_self`).

### `POST /api/invites` (admin)
`{ "email": "mate@acme.dev", "role": "member" | "admin" }` →
`201 { "invite": { id, email, role, created_at, expires_at }, "invite_url": "https://…/invite#ol_inv_…" }`

The invite token is only in this response, inside the URL fragment (never sent to servers or logged).
Valid for 7 days. Inviting the same email again replaces the old invite. Existing member → `409 already_member`.

### `GET /api/invites/:token` (public)
`200 { "invite": { email, role }, "team_name": "Acme" }`, or `404` if invalid, used or expired.

### `POST /api/invites/:token/accept` (public)
`{ "name": "Mate", "password": "at least 8 chars" }` → `200 { "user": User }` and signs in.
Single use.

---

## Projects and sources

### `GET /api/projects`
```json
{ "projects": [{
  "id": "prj_…", "name": "checkout-app", "created_at": 0, "last_event_at": 0,
  "sources": [Source],
  "stats": { "events_24h": 84120, "errors_24h": 2140, "spark": [24 hourly counts, oldest first] }
}] }
```

### `POST /api/projects`
`{ "name": "checkout-app" }` → `201 { "project": { id, name, created_at } }`.
Names: 1–64 chars, letters, digits, space, `_ . -`, unique (case-insensitive) → else `400` / `409`.

### `GET /api/projects/:id`
`200 { "project": Project, "sources": Source[] }`

### `PATCH /api/projects/:id`
`{ "name": "new-name" }` → `200 { "project": Project }`

### `DELETE /api/projects/:id` (admin)
Deletes the project, its sources, views and dashboards. Its log files stay in R2: Basin SQL is read-only,
so Open Logs cannot delete them.

### `GET /api/projects/:id/sources`
`200 { "sources": Source[] }`

`Source = { id, project_id, name, token_prefix, created_at, last_event_at, rejected_count, last_rejected_at }`

The token itself and its hash are never returned after creation.

### `POST /api/projects/:id/sources`
`{ "name": "api" }` → `201 { "source": Source, "token": "ol_…" }`. **The token is shown once.**
Names: 1–64 chars, letters, digits, `_ . -`, unique within the project.

### `GET /api/sources/:id`
`200 { "source": Source, "project": Project }`

### `PATCH /api/sources/:id`
`{ "name": "api-v2" }` → `200 { "source": Source }`. Same name rules as creating; a clash → `409 conflict`.
Logs are linked to the source by its id, so its history keeps showing under the new name.

### `POST /api/sources/:id/regenerate`
`200 { "source": Source, "token": "ol_…" }`. The old token stops working immediately.

### `DELETE /api/sources/:id` (admin)
`200 { "ok": true }`. The source's logs stay in Basin. A new source with the same name does not show them.

---

## Querying logs

All query endpoints take the same **filter** body. Clients never send SQL.

```json
{
  "project_id": "prj_…",
  "from": 1793355900000,
  "to": 1793356800000,
  "where": [
    { "field": "level", "op": "in", "value": ["error", "warn"] },
    { "field": "fields.status", "op": "=", "value": 500 },
    { "text": "payment failed" }
  ],
  "limit": 100,
  "cursor": null
}
```

- `from`/`to` are required, `from < to`, at most 7 days apart.
- `field`: `level`, `source` (by name), `message` or `fields.<key>` where key matches `^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$`
  (≤64 chars; dots walk into nested objects).
- `op`: `=`, `!=`, `in`, `not_in` (1–50 values), `contains`, `exists` (no value),
  `>`, `>=`, `<`, `<=` (numbers, `fields.*` only).
  `=`/`in` compare as text, so `500` matches both `500` and `"500"`. Booleans compare as `1`/`0`.
- `source` clauses match the source's **current** name. The server turns names into source ids before
  querying, so a renamed source keeps its history and an unknown name matches nothing.
- `{ "text": "…" }` is a case-insensitive substring search over the message and fields (1–200 chars).
- Up to 20 clauses, all ANDed. `limit` defaults to 100, capped at 500.
- A text search over more than 24h with no `=`/`in` field clause returns `422 query_too_large` with a `hint`.
  Storage timeouts map to the same error.

### `POST /api/query`
```json
{ "events": [{ "id": "…", "ts": 0, "source_id": "src_…", "source": "api", "level": "error",
               "message": "…", "fields": {} }],
  "next_cursor": "…" | null }
```
`source_id` is the source's permanent id. `source` is its name today, or the name it had when the event
arrived if the source has since been deleted. Newest first. Pass `next_cursor` back as `cursor` for the next (older) page.

### `POST /api/histogram`
```json
{ "interval_ms": 15000, "total": 8412, "errors": 412,
  "buckets": [{ "t": 0, "debug": 0, "info": 30, "warn": 3, "error": 1, "fatal": 0 }] }
```
About 60 buckets; the size is picked from 1s, 5s, 15s, 30s, 1m … 1d. Empty buckets are included.
`errors` counts `error` + `fatal`.

### `POST /api/aggregate`
Filter plus:

| Key | Values |
|---|---|
| `measure` | `count`, `count_over_time`, `avg`, `p95` |
| `field` | for `count*`: optional field to group by; for `avg`/`p95`: required numeric `fields.*` |
| `group_by` | for `avg`/`p95`: optional, defaults to `source` |

```json
{ "value": 2140, "interval_ms": 120000,
  "groups": [{ "key": "card_declined", "value": 1112 }],
  "series": [{ "t": 0, "value": 12 }] }
```
`value` is the overall number, `groups` the top 10 groups (largest first), `series` ~30 points over time
(counts zero-filled; averages skip empty buckets). p95 is approximate (Basin's `approx_percentile_cont`).
When grouped by `source`, groups are keyed by source id internally and returned with today's names;
logs from a deleted source are labelled `deleted source`.

### `GET /api/status?project_id=…`
`200 { "storage": "basin", "lag_ms": 180000, "now": 0, "newest_event_at": 0 | null }`.
`project_id` is optional; without it `newest_event_at` is `null`.
The UI uses this for honest freshness ("Data through 10:42:18 UTC · ~1–3 min ingest lag").

---

## Saved views

`View = { id, project_id, name, filter: { where: Clause[], range?: "15m"|"1h"|"24h"|"7d" }, created_at }`

- `GET /api/projects/:id/views` → `{ "views": View[] }`
- `POST /api/projects/:id/views` `{ "name": "Errors only", "filter": { "where": [...], "range": "1h" } }` → `201 { "view": View }`
- `DELETE /api/views/:id`

`where` is validated exactly like a query filter.

## Dashboards and charts

Every new project gets an **Overview** dashboard with starter charts (events, errors, warnings,
events by level, events by source, top errors).

`Dashboard = { id, project_id, name, created_at }`

`Chart = { id, dashboard_id, title, filter: { where }, field, measure, viz, size, position, created_at }`

| Key | Values |
|---|---|
| `measure` | `count`, `count_over_time`, `avg`, `p95` (same rules as `/api/aggregate`) |
| `viz` | `bar`, `pie`, `line`, `number` |
| `size` | `sm`, `md` (default), `lg` |

- `GET /api/projects/:id/dashboards` → `{ "dashboards": Dashboard[] }`
- `POST /api/projects/:id/dashboards` `{ "name": "Payments" }` → `201 { "dashboard": Dashboard }`
- `GET /api/dashboards/:id` → `{ "dashboard": Dashboard, "charts": Chart[] }` (by position)
- `PATCH /api/dashboards/:id` `{ "name": "…" }`
- `DELETE /api/dashboards/:id` (deletes its charts)
- `POST /api/dashboards/:id/charts` `{ title, filter, field, measure, viz, size? }` → `201 { "chart": Chart }` (pins to the end)
- `PATCH /api/charts/:id` any subset of the above → `{ "chart": Chart }`
- `POST /api/charts/:id/duplicate` → `201 { "chart": Chart }` titled "… (copy)"
- `DELETE /api/charts/:id`

The dashboard renders each chart by calling `POST /api/aggregate` with the chart's filter, the
dashboard's time range, `field` and `measure`. `/api/aggregate` also returns
`series_by_group: [{ key, series }]` (top 5 groups) for stacked bars and multi-line charts.

CSV export is done in the browser from the data already on screen.
