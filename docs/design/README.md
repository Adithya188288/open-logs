# Approved UI designs

Interactive canvas (owner's account, the source of truth):
https://claude.ai/artifact/5k5HBmtsD2SqpXxZJCf4Pu

The `screens/*.dc.html` files here are the exact source of those six screens, kept as reference.
They use a design-tool format (`<x-dc>` markup, `{{holes}}` filled by a `renderVals()` script, `<sc-for>`/`<sc-if>`)
and **won't render on their own in a browser**. Read them for structure, tokens, copy, and behaviour.
The real app is a React + Vite single-page app in `app/` (plain CSS with these tokens, no UI kit), built to
`dist/` and served by the Worker. Don't copy the design-tool format.

| Screen | File | Key behaviour |
|---|---|---|
| Sign in | `screens/Login.dc.html` | Email + password; first sign-in uses `ADMIN_PASSWORD` |
| Projects + team | `screens/Main.dc.html` | Project cards (live / waiting), sparkline, team table, invite with role |
| Connect a source | `screens/Project.dc.html` | 4 steps; platform picker JS/Python/Go/HTTP; full token shown once with copy; regenerate; "listening for first event" |
| Live tail | `screens/LiveTail.dc.html` | Search + chips, time range, stacked histogram (click bar = zoom 15s, legend toggles level), expandable rows with Filter/Chart per field, j/k/Enter, `/`, pause, wrap lines, "new events" banner, honest freshness text |
| Dashboard | `screens/Dashboard.dc.html` | Stat tiles with sparklines and good/bad trend colours, events by level, HTTP status donut, p95 by source, top errors, "Add chart" drawer (filter, field, measure, bar/pie/line/number, pin) |
| States | `screens/States.dc.html` | No results, loading skeleton, query too large, ingestion problem (401s) |

## Design system (copy into the app)
- Fonts: Geist (UI), Geist Mono (data, code, tokens).
- Tokens: the `.t { --bg … }` and `.t[data-theme="dark"] { … }` blocks at the top of any screen file.
- Type: 11 / 12 / 13 / 15 / 24 px. Radii: 6 (controls), 10 (cards), 999 (pills).
- Level colours: info = `--infobar`, warn = `--warn`, error = `--err`. Trends coloured by good/bad, not by direction.
- White by default, dark theme supported, remembered in `localStorage`.
