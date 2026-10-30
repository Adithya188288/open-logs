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
the Worker (`src/`), the dashboard (`public/`), the installer (`scripts/`, `create-open-logs/`).
Issues in Cloudflare's platform itself should go to Cloudflare.

## How Open Logs protects your data

- Log content is treated as attacker-controlled: the UI renders it with `textContent` only, under a strict
  Content-Security-Policy (no inline scripts, no `innerHTML`). CSV exports neutralise spreadsheet formulas.
- Clients never send SQL. Filters are validated and turned into parameterised D1 queries. Basin SQL has no
  bound parameters, so its dialect renders escaped literals from the validated filter only.
- Passwords: PBKDF2-SHA256 (100k iterations, per-user salt). Session and source tokens are random 256-bit
  values stored only as SHA-256 hashes. Source tokens are shown once.
- Session cookie: `HttpOnly; Secure; SameSite=Lax`. State-changing `/api` requests must carry our `Origin`.
- Sign-in, invite acceptance and ingest are rate limited. Sign-in errors are generic.
- Secrets live in `wrangler secret` / `.dev.vars` (gitignored), never in the repo.
