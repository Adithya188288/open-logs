# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the on-call backend or platform engineer debugging something that is happening now. They arrive
from an alert or a bug report, open live tail, search and filter down to the failing requests, open an event,
and copy a link to it for a teammate. Dashboards come second: a quick read of error rates and levels per source.

Also: the team owner or admin who deploys Open Logs, invites teammates, creates projects and connects sources.

## Product Purpose

Open Logs is open-source, self-hosted log management that runs in the team's own Cloudflare account.
Cloudflare Basin (Pipelines + Catalog + SQL) is serverless log storage with no product on top: no per-app ingest
auth, no log viewer, no charts without SQL, no team login. Open Logs is that product layer.
Success: a team deploys it with one command, sends logs over HTTP, and debugs from the live tail without writing SQL.

## Positioning

- A log product at the level of paid tools such as Better Stack: live tail, search, filters, charts, dashboards.
- Runs in your own Cloudflare account; logs never leave it.
- Free and open source; no seats, no licence.
- Cheap at scale because storage is Basin (Iceberg in R2). **Unverified:** this claim must be checked against
  current Basin pricing and real usage before it appears in any copy.

## Operating Context

- Used in a browser, often during an incident, often in dark rooms and long sessions; also during calm daily checks.
- Logs arrive by `POST /v1/logs` with a per-source token; no SDK.
- Production storage is Basin, where new events take about 1.5 to 3.5 minutes to become queryable. The UI says
  how fresh the data is instead of pretending to be real time. Local development uses D1.
- Keyboard use is part of the workflow: `/` to search, `j`/`k` to move between events, Enter to open one.

## Capabilities and Constraints

- Screens: sign in, invite acceptance, projects, team, settings (team name, change password), sources and source
  detail (connect, token shown once, regenerate), live tail (search, field filters, time range, histogram with zoom,
  saved views, event side panel, copy link to event, export CSV), dashboards (charts with filter, field, measure,
  bar/pie/line/number, per-chart CSV export).
- Projects only organise sources; every team member sees every project. Roles: owner, admin, member.
- Every delete is confirmed by typing DELETE.
- Invites always show the link; an email goes out only when email is configured.
- Stack: React + Vite single-page app with plain CSS and design tokens, no UI kit; Hono on Cloudflare Workers.
- Loading: one start-up load per project with a small pulsing green dot, then no loaders between screens. Live tail
  and dashboard refresh every 30s only while the tab is visible.
- Undecided: collapsible sidebar for narrow windows; retention controls (documented only for now).

## Brand Commitments

- Name: Open Logs (`open-logs`).
- The small pulsing green dot is the loading mark. No logo-style loaders.
- Light theme by default; dark theme equally polished and remembered per browser.

## Evidence on Hand

- Running staging deployment with real Basin data (owner's account).
- Screenshots in `docs/screenshots/`; approved screen designs in `docs/design/`.
- No customers, testimonials, benchmarks or cost figures exist yet. Do not invent them.

## Product Principles

1. The incident comes first: getting from an alert to the failing event must be fast and obvious.
2. Be honest about data: show freshness, lag and limits plainly.
3. Load once, then feel instant: no spinners when moving between screens.
4. Familiar, dependable controls over novelty; this is a tool people trust under pressure.
5. Small and correct over feature-rich.

## Accessibility & Inclusion

WCAG 2.1 AA: text contrast at least 4.5:1 in both themes, visible focus, and every flow usable from the keyboard.
