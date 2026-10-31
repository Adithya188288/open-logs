import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('D1 schema', () => {
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
