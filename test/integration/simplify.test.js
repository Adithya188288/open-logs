import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, api, sessionCookie, signInOwner } from '../helpers.js';

async function member(owner, email = 'm@example.com') {
  const inv = await api('/api/invites', { cookie: owner, body: { email, role: 'member' } });
  const acc = await api(`/api/invites/${inv.json.invite_url.split('#')[1]}/accept`, {
    body: { name: 'Mem', password: 'member-password' },
  });
  return sessionCookie(acc.res);
}

describe('default project', () => {
  it('is created when the owner first signs in, with its Overview dashboard', async () => {
    const cookie = await signInOwner();
    const { json } = await api('/api/projects', { cookie });
    expect(json.projects.map((p) => p.name)).toEqual(['Default']);
    const boards = await api(`/api/projects/${json.projects[0].id}/dashboards`, { cookie });
    expect(boards.json.dashboards.map((d) => d.name)).toEqual(['Overview']);
  });

  it('is not created again on later sign-ins', async () => {
    await signInOwner();
    const cookie = await signInOwner();
    expect((await api('/api/projects', { cookie })).json.projects).toHaveLength(1);
  });
});

describe('settings', () => {
  it('admins rename the team; everyone sees the new name', async () => {
    const owner = await signInOwner();
    expect((await api('/api/settings', { cookie: owner })).json.settings.team_name).toBe('Open Logs');
    const saved = await api('/api/settings', { method: 'PATCH', cookie: owner, body: { team_name: 'Acme' } });
    expect(saved.json.settings.team_name).toBe('Acme');
    expect((await api('/api/config')).json.team_name).toBe('Acme');
    expect((await api('/api/me', { cookie: owner })).json.team_name).toBe('Acme');
    const m = await member(owner);
    expect(
      (await api('/api/settings', { method: 'PATCH', cookie: m, body: { team_name: 'x' } })).status,
    ).toBe(403);
    expect(
      (await api('/api/settings', { method: 'PATCH', cookie: owner, body: { team_name: '' } })).status,
    ).toBe(400);
  });

  it('changes your password and signs out your other sessions', async () => {
    const owner = await signInOwner();
    const other = await signInOwner();
    const wrong = await api('/api/me/password', {
      cookie: owner,
      body: { current_password: 'nope-nope', new_password: 'brand-new-pass' },
    });
    expect(wrong.status).toBe(400);
    const ok = await api('/api/me/password', {
      cookie: owner,
      body: { current_password: ADMIN_PASSWORD, new_password: 'brand-new-pass' },
    });
    expect(ok.status).toBe(200);
    expect((await api('/api/me', { cookie: owner })).status).toBe(200);
    expect((await api('/api/me', { cookie: other })).status).toBe(401);
    expect(
      (await api('/api/auth/login', { body: { email: ADMIN_EMAIL, password: 'brand-new-pass' } })).status,
    ).toBe(200);
    expect(
      (await api('/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).status,
    ).toBe(401);
  });
});

describe('passwords keep every character', () => {
  it('a password with surrounding spaces signs in exactly as it was set', async () => {
    const owner = await signInOwner();
    const spaced = ' spaced pass ';
    const changed = await api('/api/me/password', {
      cookie: owner,
      body: { current_password: ADMIN_PASSWORD, new_password: spaced },
    });
    expect(changed.status).toBe(200);
    expect((await api('/api/auth/login', { body: { email: ADMIN_EMAIL, password: spaced } })).status).toBe(
      200,
    );
    expect(
      (await api('/api/auth/login', { body: { email: ADMIN_EMAIL, password: spaced.trim() } })).status,
    ).toBe(401);
  });

  it('an invited teammate signs in with the exact password they chose', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'pad@example.com', role: 'member' },
    });
    const token = inv.json.invite_url.split('#')[1];
    const accepted = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Pad', password: 'trailing-space ' },
    });
    expect(accepted.status).toBe(200);
    const login = await api('/api/auth/login', {
      body: { email: 'pad@example.com', password: 'trailing-space ' },
    });
    expect(login.status).toBe(200);
  });
});

describe('invite acceptance is all or nothing', () => {
  it('leaves the invite usable when the account cannot be created', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'race@example.com', role: 'member' },
    });
    const token = inv.json.invite_url.split('#')[1];
    // Someone with that email joins another way before the invite is accepted.
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, password_hash, password_salt, role, created_at, last_active_at)
       VALUES ('usr_race', 'race@example.com', 'Race', 'x', 'x', 'member', 0, 0)`,
    ).run();
    const accepted = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Race', password: 'race-password' },
    });
    expect(accepted.status).toBe(409);
    expect((await api(`/api/invites/${token}`)).status).toBe(200);
  });

  it('cannot be reused after the account it created is removed', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'once@example.com', role: 'member' },
    });
    const token = inv.json.invite_url.split('#')[1];
    const first = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Once', password: 'once-password' },
    });
    expect(first.status).toBe(200);
    await api(`/api/users/${first.json.user.id}`, { method: 'DELETE', cookie: owner });
    const again = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Again', password: 'again-password' },
    });
    expect(again.status).toBe(404);
  });
});

describe('sources', () => {
  it('gets one source with its project and renames it', async () => {
    const cookie = await signInOwner();
    const { json: p } = await api('/api/projects', { cookie });
    const project = p.projects[0];
    const { json: s } = await api(`/api/projects/${project.id}/sources`, { cookie, body: { name: 'api' } });
    const one = await api(`/api/sources/${s.source.id}`, { cookie });
    expect(one.json).toMatchObject({ source: { name: 'api' }, project: { id: project.id } });
    const renamed = await api(`/api/sources/${s.source.id}`, {
      method: 'PATCH',
      cookie,
      body: { name: 'billing-api' },
    });
    expect(renamed.json.source.name).toBe('billing-api');
    expect(
      (await api(`/api/sources/${s.source.id}`, { method: 'PATCH', cookie, body: { name: 'bad name!' } }))
        .status,
    ).toBe(400);
    await api(`/api/projects/${project.id}/sources`, { cookie, body: { name: 'web' } });
    expect(
      (await api(`/api/sources/${s.source.id}`, { method: 'PATCH', cookie, body: { name: 'web' } })).status,
    ).toBe(409);
  });
});

describe('invites', () => {
  it('always returns the link and says whether an email went out', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'mate@example.com', role: 'member' },
    });
    expect(inv.json.invite_url).toMatch(/\/invite#ol_inv_/);
    expect(inv.json.email).toEqual({ sent: false, reason: 'not_configured' });
  });
});

describe('security review fixes', () => {
  it('rate limits current-password guesses', async () => {
    const cookie = await signInOwner();
    let last = 0;
    for (let i = 0; i < 15 && last !== 429; i++) {
      last = (
        await api('/api/me/password', {
          cookie,
          body: { current_password: `guess-${i}-wrong`, new_password: 'brand-new-pass' },
        })
      ).status;
    }
    expect(last).toBe(429);
  });

  it('answers unknown /api paths with 401 when signed out and 404 when signed in', async () => {
    expect((await api('/api/no-such-endpoint')).status).toBe(401);
    const cookie = await signInOwner();
    expect((await api('/api/no-such-endpoint', { cookie })).status).toBe(404);
  });

  it('shows the team name from settings on the invite page', async () => {
    const owner = await signInOwner();
    await api('/api/settings', { method: 'PATCH', cookie: owner, body: { team_name: 'Acme Ops' } });
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'x@example.com', role: 'member' },
    });
    const token = inv.json.invite_url.split('#')[1];
    expect((await api(`/api/invites/${token}`)).json.team_name).toBe('Acme Ops');
  });
});
