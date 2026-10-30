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
| 400 | `invalid_json`, `invalid_body`, `invalid_field`, `invalid_filter`, `invalid_event`, `empty_batch` |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_token` |
| 403 | `forbidden`, `bad_origin`, `cannot_remove_self` |
| 404 | `not_found` |
| 409 | `conflict`, `already_member` |
| 413 | `payload_too_large`, `event_too_large`, `too_many_events` |
| 422 | `query_too_large` (includes a `hint`) |
| 429 | `rate_limited` |

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
| `project_id`, `source` | the token | Always set by the server. Body keys with these names are dropped. |
| `fields` | every other key | Kept as JSON; filterable and chartable as `fields.<key>` (nested: `fields.http.status`). |

Limits: 5 MB per request, 10,000 events per request, 256 KB per event, 1,200 requests per minute per
token (batch your events). CORS is open (`*`) because auth is the bearer token, not a cookie.

Errors: `401 invalid_token`, `400 invalid_json|empty_batch|invalid_event` (with `index`),
`413 payload_too_large|too_many_events|event_too_large` (with `index`), `429 rate_limited`.

Requests made with a regenerated (old) token are counted on that source
(`rejected_count`, `last_rejected_at`) so the dashboard can show an ingestion problem.

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

### `GET /api/config` (public)
`200 { "team_name": "Acme" }`: used by the sign-in page.

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
Deletes the project, its sources, views and dashboards. With `LOG_STORAGE=local` its logs are deleted
too. With Basin, already-written log files stay in R2 (Basin SQL is read-only).

### `GET /api/projects/:id/sources`
`200 { "sources": Source[] }`

`Source = { id, project_id, name, token_prefix, created_at, last_event_at, rejected_count, last_rejected_at }`

The token itself and its hash are never returned after creation.

### `POST /api/projects/:id/sources`
`{ "name": "api" }` → `201 { "source": Source, "token": "ol_…" }`. **The token is shown once.**
Names: 1–64 chars, letters, digits, `_ . -`, unique within the project.

### `POST /api/sources/:id/regenerate`
`200 { "source": Source, "token": "ol_…" }`. The old token stops working immediately.

### `DELETE /api/sources/:id` (admin)

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
- `field`: `level`, `source`, `message` or `fields.<key>` where key matches `^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$`
  (≤64 chars; dots walk into nested objects).
- `op`: `=`, `!=`, `in`, `not_in` (1–50 values), `contains`, `exists` (no value),
  `>`, `>=`, `<`, `<=` (numbers, `fields.*` only).
  `=`/`in` compare as text, so `500` matches both `500` and `"500"`. Booleans compare as `1`/`0`.
- `{ "text": "…" }` is a case-insensitive substring search over the message and fields (1–200 chars).
- Up to 20 clauses, all ANDed. `limit` defaults to 100, capped at 500.
- A text search over more than 24h with no `=`/`in` field clause returns `422 query_too_large` with a `hint`.
  Storage timeouts map to the same error.

### `POST /api/query`
```json
{ "events": [{ "id": "…", "ts": 0, "source": "api", "level": "error", "message": "…", "fields": {} }],
  "next_cursor": "…" | null }
```
Newest first. Pass `next_cursor` back as `cursor` for the next (older) page.

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
(counts zero-filled; averages skip empty buckets). p95 is nearest-rank.

### `GET /api/status?project_id=…`
`200 { "storage": "local" | "basin", "lag_ms": 0, "now": 0, "newest_event_at": 0 | null }`.
The UI uses this for honest freshness ("Data through 10:42:18 UTC · ~60s ingest lag").
