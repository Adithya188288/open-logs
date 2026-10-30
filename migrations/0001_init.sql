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

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

-- token_hash is the SHA-256 of the source token; token_prefix is its first 8 characters.
-- prev_token_prefix lets ingest attribute 401s from a regenerated token to its source.
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  prev_token_prefix TEXT,
  created_at INTEGER NOT NULL,
  last_event_at INTEGER,
  rejected_count INTEGER NOT NULL DEFAULT 0,
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

-- Log storage for LOG_STORAGE=local. Production uses Basin instead.
CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX logs_project_ts ON logs(project_id, ts DESC, id DESC);
CREATE INDEX logs_project_level_ts ON logs(project_id, level, ts DESC);
