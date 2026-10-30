import { describe, expect, it } from 'vitest';
import { api, sessionCookie, signInOwner } from '../helpers.js';

async function memberCookie(owner) {
  const inv = await api('/api/invites', {
    cookie: owner,
    body: { email: 'member@example.com', role: 'member' },
  });
  const token = inv.json.invite_url.split('#')[1];
  const acc = await api(`/api/invites/${token}/accept`, {
    body: { name: 'Mem', password: 'member-password' },
  });
  return sessionCookie(acc.res);
}

describe('projects', () => {
  it('creates, lists, renames and deletes a project', async () => {
    const cookie = await signInOwner();
    const created = await api('/api/projects', { cookie, body: { name: 'checkout-app' } });
    expect(created.status).toBe(201);
    const id = created.json.project.id;
    expect(id).toMatch(/^prj_/);

    const list = await api('/api/projects', { cookie });
    expect(list.json.projects.map((p) => p.name)).toEqual(['checkout-app']);

    const renamed = await api(`/api/projects/${id}`, { method: 'PATCH', cookie, body: { name: 'shop' } });
    expect(renamed.status).toBe(200);
    expect(renamed.json.project.name).toBe('shop');

    const one = await api(`/api/projects/${id}`, { cookie });
    expect(one.json.project.name).toBe('shop');

    expect((await api(`/api/projects/${id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/api/projects/${id}`, { cookie })).status).toBe(404);
  });

  it('rejects duplicate and invalid names', async () => {
    const cookie = await signInOwner();
    await api('/api/projects', { cookie, body: { name: 'dup' } });
    expect((await api('/api/projects', { cookie, body: { name: 'DUP' } })).status).toBe(409);
    expect((await api('/api/projects', { cookie, body: { name: '' } })).status).toBe(400);
    expect((await api('/api/projects', { cookie, body: { name: '<script>' } })).status).toBe(400);
  });

  it('only admins and owners delete projects', async () => {
    const owner = await signInOwner();
    const { json } = await api('/api/projects', { cookie: owner, body: { name: 'keep' } });
    const member = await memberCookie(owner);
    expect((await api(`/api/projects/${json.project.id}`, { method: 'DELETE', cookie: member })).status).toBe(
      403,
    );
  });
});

describe('sources', () => {
  it('creates a source and returns its token exactly once', async () => {
    const cookie = await signInOwner();
    const { json: p } = await api('/api/projects', { cookie, body: { name: 'app' } });
    const created = await api(`/api/projects/${p.project.id}/sources`, { cookie, body: { name: 'api' } });
    expect(created.status).toBe(201);
    expect(created.json.token).toMatch(/^ol_[A-Za-z0-9_-]{43}$/);
    expect(created.json.source.token_prefix).toBe(created.json.token.slice(0, 8));
    expect(created.json.source.token_hash).toBeUndefined();

    const list = await api(`/api/projects/${p.project.id}/sources`, { cookie });
    expect(list.json.sources).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(created.json.token);
    expect(list.json.sources[0].token_hash).toBeUndefined();
  });

  it('stores only a SHA-256 hash of the token', async () => {
    const { env } = await import('cloudflare:test');
    const cookie = await signInOwner();
    const { json: p } = await api('/api/projects', { cookie, body: { name: 'app' } });
    const { json } = await api(`/api/projects/${p.project.id}/sources`, { cookie, body: { name: 'api' } });
    const row = await env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(json.source.id).first();
    expect(JSON.stringify(row)).not.toContain(json.token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('regenerates a token and deletes a source', async () => {
    const cookie = await signInOwner();
    const { json: p } = await api('/api/projects', { cookie, body: { name: 'app' } });
    const { json: s } = await api(`/api/projects/${p.project.id}/sources`, { cookie, body: { name: 'api' } });
    const regen = await api(`/api/sources/${s.source.id}/regenerate`, { method: 'POST', cookie });
    expect(regen.status).toBe(200);
    expect(regen.json.token).not.toBe(s.token);
    expect((await api(`/api/sources/${s.source.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/api/projects/${p.project.id}/sources`, { cookie })).json.sources).toEqual([]);
  });

  it('rejects duplicate source names in a project and unknown projects', async () => {
    const cookie = await signInOwner();
    const { json: p } = await api('/api/projects', { cookie, body: { name: 'app' } });
    await api(`/api/projects/${p.project.id}/sources`, { cookie, body: { name: 'api' } });
    expect(
      (await api(`/api/projects/${p.project.id}/sources`, { cookie, body: { name: 'api' } })).status,
    ).toBe(409);
    expect((await api('/api/projects/prj_nope/sources', { cookie, body: { name: 'api' } })).status).toBe(404);
  });

  it('lists projects with their sources', async () => {
    const cookie = await signInOwner();
    const { json: p } = await api('/api/projects', { cookie, body: { name: 'app' } });
    await api(`/api/projects/${p.project.id}/sources`, { cookie, body: { name: 'web' } });
    const list = await api('/api/projects', { cookie });
    expect(list.json.projects[0].sources.map((s) => s.name)).toEqual(['web']);
  });
});
