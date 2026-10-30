import { describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, api, sessionCookie, signInOwner } from '../helpers.js';

describe('auth', () => {
  it('creates the owner on first sign-in with ADMIN_PASSWORD', async () => {
    const { status, json, res } = await api('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(status).toBe(200);
    expect(json.user).toMatchObject({ email: ADMIN_EMAIL, role: 'owner' });
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/ol_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('rejects a wrong first password with a generic error', async () => {
    const { status, json } = await api('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: 'nope-nope' },
    });
    expect(status).toBe(401);
    expect(json.error.message).toBe('Invalid email or password');
  });

  it('signs in again with email + password once the owner exists', async () => {
    await signInOwner();
    const again = await api('/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(again.status).toBe(200);
    const other = await api('/api/auth/login', {
      body: { email: 'someone@example.com', password: ADMIN_PASSWORD },
    });
    expect(other.status).toBe(401);
    expect(other.json.error.message).toBe('Invalid email or password');
  });

  it('returns the current user from /api/me', async () => {
    const cookie = await signInOwner();
    const { status, json } = await api('/api/me', { cookie });
    expect(status).toBe(200);
    expect(json.user.email).toBe(ADMIN_EMAIL);
    expect(json.user.password_hash).toBeUndefined();
  });

  it('returns 401 on app routes without a session', async () => {
    expect((await api('/api/me')).status).toBe(401);
    expect((await api('/api/projects')).status).toBe(401);
    expect((await api('/api/me', { cookie: 'ol_session=bogus' })).status).toBe(401);
  });

  it('signs out and invalidates the session', async () => {
    const cookie = await signInOwner();
    const out = await api('/api/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(200);
    expect(out.res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await api('/api/me', { cookie })).status).toBe(401);
  });

  it('rejects state-changing requests from another origin', async () => {
    const cookie = await signInOwner();
    const { status } = await api('/api/projects', {
      cookie,
      body: { name: 'x' },
      headers: { origin: 'https://evil.example' },
    });
    expect(status).toBe(403);
  });

  it('rate limits repeated sign-in attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await api('/api/auth/login', {
          body: { email: 'x@example.com', password: 'wrong-password' },
          headers: { 'cf-connecting-ip': '192.0.2.1' },
        })
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe('invites and roles', () => {
  it('owner invites a teammate who accepts and signs in', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'mate@example.com', role: 'member' },
    });
    expect(inv.status).toBe(201);
    expect(inv.json.invite_url).toMatch(/\/invite#ol_inv_/);
    const token = inv.json.invite_url.split('#')[1];

    const peek = await api(`/api/invites/${token}`);
    expect(peek.json.invite).toMatchObject({ email: 'mate@example.com', role: 'member' });

    const accept = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Mate', password: 'mate-password-1' },
    });
    expect(accept.status).toBe(200);
    const mateCookie = sessionCookie(accept.res);
    expect((await api('/api/me', { cookie: mateCookie })).json.user.role).toBe('member');

    const reuse = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Mate', password: 'mate-password-1' },
    });
    expect(reuse.status).toBe(404);

    const login = await api('/api/auth/login', {
      body: { email: 'mate@example.com', password: 'mate-password-1' },
    });
    expect(login.status).toBe(200);

    const users = await api('/api/users', { cookie: owner });
    expect(users.json.users.map((u) => u.email).sort()).toEqual(['mate@example.com', ADMIN_EMAIL]);
  });

  it('members cannot invite', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'm@example.com', role: 'member' },
    });
    const token = inv.json.invite_url.split('#')[1];
    const acc = await api(`/api/invites/${token}/accept`, {
      body: { name: 'M', password: 'member-password' },
    });
    const member = sessionCookie(acc.res);
    const denied = await api('/api/invites', {
      cookie: member,
      body: { email: 'z@example.com', role: 'member' },
    });
    expect(denied.status).toBe(403);
  });

  it('rejects invalid invite input', async () => {
    const owner = await signInOwner();
    expect(
      (await api('/api/invites', { cookie: owner, body: { email: 'not-an-email', role: 'member' } })).status,
    ).toBe(400);
    expect(
      (await api('/api/invites', { cookie: owner, body: { email: 'a@b.co', role: 'owner' } })).status,
    ).toBe(400);
    expect(
      (await api('/api/invites', { cookie: owner, body: { email: ADMIN_EMAIL, role: 'member' } })).status,
    ).toBe(409);
  });

  it('owner removes a teammate and their sessions stop working', async () => {
    const owner = await signInOwner();
    const inv = await api('/api/invites', {
      cookie: owner,
      body: { email: 'gone@example.com', role: 'admin' },
    });
    const token = inv.json.invite_url.split('#')[1];
    const acc = await api(`/api/invites/${token}/accept`, {
      body: { name: 'Gone', password: 'gone-password' },
    });
    const gone = sessionCookie(acc.res);
    const id = acc.json.user.id;
    expect((await api(`/api/users/${id}`, { method: 'DELETE', cookie: gone })).status).toBe(403);
    expect((await api(`/api/users/${id}`, { method: 'DELETE', cookie: owner })).status).toBe(200);
    expect((await api('/api/me', { cookie: gone })).status).toBe(401);
  });
});
