# Open Logs

**Open-source, self-hosted log management for your own Cloudflare account.**
Live tail, search, filters, charts and dashboards for your team, on Cloudflare Workers + D1 (+ Basin at volume).
Your logs never leave your account.

![Live tail](docs/screenshots/live-tail-light.png)

| Dashboards | Connect a source |
|---|---|
| ![Dashboard](docs/screenshots/dashboard-dark.png) | ![Connect](docs/screenshots/connect-light.png) |

## Why

Cloudflare Basin (Pipelines + Catalog + SQL) is cheap, serverless log storage, but there's no product on
top: no per-app ingest auth, no log viewer, no charts without SQL, no team login. Open Logs is that layer.

## Install

```bash
npx create-open-logs
```

This clones the repo, runs `wrangler login` if needed, deploys the Worker (creating its D1 database),
applies migrations and sets a random `ADMIN_PASSWORD`, which it prints once. Open the `workers.dev` URL,
sign in with any email and that password: you're now the owner. Invite your team from the Projects page.

From a clone instead:

```bash
git clone https://github.com/Adithya188288/open-logs && cd open-logs
npm install
npm run setup
```

Or use the button (deploys the Worker and D1; set the `ADMIN_PASSWORD` secret in the dashboard afterwards,
then run `npx wrangler d1 migrations apply DB --remote`. It cannot create Basin resources):

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Adithya188288/open-logs)

### Storage: D1 or Basin

| | `LOG_STORAGE=local` (default) | `LOG_STORAGE=basin` |
|---|---|---|
| Where logs live | D1 `logs` table | Iceberg table in R2 via Basin Pipelines |
| Freshness | seconds | ~60s (Iceberg sink roll interval minimum) |
| Plan | Workers free is fine for small teams | Workers Paid ($5/month) + Basin usage |
| Good for | trying it out, low volume | real traffic, long retention |

To use Basin: `node scripts/setup-basin.js` (creates bucket, catalog, stream, sink, pipeline), fill the ids it
prints into `env.staging` in `wrangler.jsonc`, add the `BASIN_SQL_TOKEN` secret, then
`npx wrangler deploy --env staging`. See [Basin status](#basin-status) below.

## Send logs

Create a project, add a source, and copy its token (shown once). No SDK: it's one HTTP POST of a JSON
object or an array of them. Every key besides `level`, `message`, `ts` becomes a filterable field.

**curl**
```bash
curl -X POST https://YOUR-WORKER.workers.dev/v1/logs \
  -H "Authorization: Bearer $LOGS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"level":"error","message":"payment failed","order_id":4821}'
```

**JavaScript** (Node 18+, Bun, Deno)
```js
await fetch("https://YOUR-WORKER.workers.dev/v1/logs", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LOGS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ level: "error", message: "payment failed", order_id: 4821 }),
});
```

**Python** (standard library)
```python
import json, os, urllib.request
req = urllib.request.Request("https://YOUR-WORKER.workers.dev/v1/logs", method="POST",
    data=json.dumps({"level": "error", "message": "payment failed", "order_id": 4821}).encode(),
    headers={"Authorization": "Bearer " + os.environ["LOGS_TOKEN"], "Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=5)
```

**Go**
```go
body, _ := json.Marshal(map[string]any{"level": "error", "message": "payment failed", "order_id": 4821})
req, _ := http.NewRequest("POST", "https://YOUR-WORKER.workers.dev/v1/logs", bytes.NewReader(body))
req.Header.Set("Authorization", "Bearer "+os.Getenv("LOGS_TOKEN"))
req.Header.Set("Content-Type", "application/json")
http.DefaultClient.Do(req)
```

The connect page generates these with your URL filled in, and the e2e suite runs each one exactly as shown.

## Use it

- **Live tail**: type text or `field:value` (`level:error`, `status:>=500`, `source:api,worker`, `code:*`),
  pick 15m / 1h / 24h / 7d / custom, click a histogram bar to zoom, toggle levels in the legend, `j`/`k` to move,
  `Enter` to expand, `/` to search. Expand an event to filter or chart any field.
- **Dashboards**: count, count over time, average or p95 of any field as bar, pie, line or number. Pin, edit,
  duplicate, remove, export CSV.
- **Saved views** in the sidebar, **team** invites with owner / admin / member roles, light and dark themes.

## Limits

| | |
|---|---|
| Request | 5 MB, 10,000 events |
| Event | 256 KB |
| Ingest rate | 1,200 requests/min per token (batch your events) |
| Query range | 7 days, 500 rows per page; free-text search over more than 24h needs a field filter |
| Timestamps | client `ts` within ±24h of server time is kept, otherwise server time is used |

Full contract: [docs/API.md](docs/API.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Basin status

The Basin adapter is written and unit-tested against a mocked Basin SQL API, but **has not yet run against
real Basin**. Known gaps, to confirm on the first staging deploy (details in [docs/PLAN.md](docs/PLAN.md)):
the Basin SQL response JSON shape is undocumented, nested JSON paths use variadic `json_get_*` arguments,
and p95 is approximate (`approx_percentile_cont`). Deleting a project does not delete its Basin files.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars        # sets a local ADMIN_PASSWORD
npm run db:migrate:local
npm run dev                            # http://localhost:8787
npm test                               # Worker tests in the Workers runtime (Vitest)
npm run test:e2e                       # Playwright against wrangler dev, light + dark
npm run lint
```

Worker: Hono on Cloudflare Workers (`src/`). UI: React + Vite (`app/`), built to `dist/` and served by the Worker.
`npm run dev` builds the UI and runs `wrangler dev`; for hot reload run `npm run dev:ui` alongside it.
Plain JavaScript with JSDoc. Git Flow: feature branches into `develop`,
releases into `main`. See [CLAUDE.md](CLAUDE.md) and [docs/PLAN.md](docs/PLAN.md).

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

MIT
