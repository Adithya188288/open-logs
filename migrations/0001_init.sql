-- Open Logs app schema. Times are unix milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at INTEGER NOT NULL,
  last_active_at INTEGER
);

-- id is the SHA-256 of the session token; the token itself only lives in the cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER
);

-- Team-wide settings editable in the app (e.g. team_name). Falls back to Worker vars when unset.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

-- token_hash is the SHA-256 of the source token; token_prefix is its first 8 characters.
-- prev_token_prefix lets ingest attribute 401s from a regenerated token to its source.
-- first_event_at is written once, by the source's first accepted log; logs after that never write to D1.
-- last_rejected_at is written at most once a minute per source, so a sender stuck on an old token can't
-- turn into a stream of writes.
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  prev_token_prefix TEXT,
  created_at INTEGER NOT NULL,
  first_event_at INTEGER,
  last_rejected_at INTEGER,
  UNIQUE (project_id, name)
);
CREATE INDEX sources_prefix ON sources(token_prefix);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE dashboards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE charts (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  field TEXT,
  measure TEXT NOT NULL CHECK (measure IN ('count', 'count_over_time', 'avg', 'p95')),
  viz TEXT NOT NULL CHECK (viz IN ('bar', 'pie', 'line', 'number')),
  position INTEGER NOT NULL DEFAULT 0,
  size TEXT NOT NULL DEFAULT 'md' CHECK (size IN ('sm', 'md', 'lg')),
  created_at INTEGER NOT NULL
);
