import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const TABLES = [
  'users',
  'sessions',
  'invites',
  'projects',
  'sources',
  'saved_views',
  'dashboards',
  'charts',
  'logs',
];

describe('D1 schema', () => {
  it('creates every app table', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const names = results.map((r) => r.name);
    for (const table of TABLES) expect(names).toContain(table);
  });

  it('indexes logs by project and time', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'logs'",
    ).all();
    expect(results.map((r) => r.name)).toContain('logs_project_ts');
  });

  it('cascades source deletion when a project is deleted', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id, name, created_at) VALUES ('prj_x', 'x', 0)"),
      env.DB.prepare(
        "INSERT INTO sources (id, project_id, name, token_hash, token_prefix, created_at) VALUES ('src_x', 'prj_x', 'api', 'h', 'ol_abcde', 0)",
      ),
    ]);
    await env.DB.prepare("DELETE FROM projects WHERE id = 'prj_x'").run();
    const row = await env.DB.prepare("SELECT id FROM sources WHERE id = 'src_x'").first();
    expect(row).toBeNull();
  });
});
