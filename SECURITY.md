# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting on this repository
(Security tab → "Report a vulnerability"), or email the maintainer at the address on their GitHub profile.

Include what you found, how to reproduce it, and the impact you expect. You'll get an acknowledgement
within 3 working days and a fix or mitigation plan within 14 days for confirmed critical or high issues.
Credit is given in the release notes unless you'd rather stay anonymous.

## Scope

Open Logs runs entirely in **your** Cloudflare account. Reports about this codebase are in scope:
the Worker (`src/`), the dashboard (`app/`), and the install scripts (`scripts/`).
Issues in Cloudflare's platform itself should go to Cloudflare.

## Recommended: put Open Logs behind Cloudflare Access

Open Logs is self-hosted, and its `workers.dev` URL is public by default. Put it behind Cloudflare Access
(free for up to 50 users) so only your team can reach it:

1. Zero Trust → Access → Applications → Add an application → Self-hosted, for the Worker's `workers.dev`
   hostname, with an Allow policy for your team's emails.
2. Add a second self-hosted application for the same hostname with the path `/v1/logs` and a Bypass policy
   for Everyone. Apps send logs there with their source token and cannot pass a sign-in page.

The app's own sign-in stays on as a second layer. Step-by-step instructions are in the README.

## How Open Logs protects your data

- Log content is treated as attacker-controlled. The React UI renders it as text only (no
  `dangerouslySetInnerHTML`), under a strict Content-Security-Policy (`app/public/_headers`: no inline
  scripts). CSV exports neutralise spreadsheet formulas.
- Clients never send SQL. Filters are validated against a whitelist of columns and field names, then turned
  into Basin SQL. Basin SQL has no bound parameters, so values from the validated filter are rendered as
  escaped literals. D1 queries use bound parameters.
- Passwords: PBKDF2-SHA256 (100k iterations, per-user salt). Session and source tokens are random 256-bit
  values stored only as SHA-256 hashes. Source tokens are shown once.
- The Cloudflare API token used for Basin is stored only as the `BASIN_SQL_TOKEN` Worker secret (and by
  Cloudflare in the Basin sink's config). Setup and the other scripts never write it to disk and hide it in
  their output.
- Session cookie: `HttpOnly; Secure; SameSite=Lax`. State-changing `/api` requests must carry our `Origin`.
- Sign-in, password change, invite acceptance and ingest are rate limited. Sign-in errors are generic.
- Secrets live in Worker secrets (`wrangler secret`), never in the repo. `.open-logs/` (each install's
  generated config and resource ids) and `.dev.vars` are gitignored.
