import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api, createProjectWithSource, ingest, signInOwner } from '../helpers.js';

describe('ingest', () => {
  it('accepts one event or a batch and records when the source last sent', async () => {
    const cookie = await signInOwner();
    const { source, token } = await createProjectWithSource(cookie);

    const one = await ingest(token, {
      level: 'error',
      message: 'payment failed',
      order_id: 4821,
      source: 'spoofed',
    });
    expect(one.status).toBe(202);
    expect(one.json).toEqual({ accepted: 1 });

    const many = await ingest(token, [{ message: 'a' }, { message: 'b', level: 'warn' }]);
    expect(many.json).toEqual({ accepted: 2 });

    const row = await env.DB.prepare('SELECT last_event_at FROM sources WHERE id = ?')
      .bind(source.id)
      .first();
    expect(row.last_event_at).toBeGreaterThan(0);
  });

  it('rejects missing and bad tokens with 401', async () => {
    const res = await exports.default.fetch('http://localhost/v1/logs', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect((await ingest('ol_notarealtoken', { message: 'x' })).status).toBe(401);
    expect((await ingest('Basic abc', { message: 'x' })).status).toBe(401);
  });

  it('stops accepting a regenerated token and records the rejections on its source', async () => {
    const cookie = await signInOwner();
    const { source, token } = await createProjectWithSource(cookie);
    const regen = await api(`/api/sources/${source.id}/regenerate`, { method: 'POST', cookie });
    expect((await ingest(token, { message: 'old' })).status).toBe(401);
    expect((await ingest(token, { message: 'old' })).status).toBe(401);
    expect((await ingest(regen.json.token, { message: 'new' })).status).toBe(202);
    const row = await env.DB.prepare('SELECT rejected_count FROM sources WHERE id = ?')
      .bind(source.id)
      .first();
    expect(row.rejected_count).toBe(2);
  });

  it('returns 413 for an oversized batch or event', async () => {
    const cookie = await signInOwner();
    const { token } = await createProjectWithSource(cookie);
    const big = JSON.stringify([{ message: 'x'.repeat(5 * 1024 * 1024) }]);
    expect((await ingest(token, big)).status).toBe(413);
    const fatEvent = await ingest(token, [{ message: 'y'.repeat(300 * 1024) }]);
    expect(fatEvent.status).toBe(413);
    expect(fatEvent.json.error.index).toBe(0);
  });

  it('rejects invalid bodies with 400', async () => {
    const cookie = await signInOwner();
    const { token } = await createProjectWithSource(cookie);
    expect((await ingest(token, 'not json')).status).toBe(400);
    expect((await ingest(token, [])).status).toBe(400);
    expect((await ingest(token, [{ message: 'ok' }, 'nope'])).status).toBe(400);
  });

  it('answers CORS preflight so browser apps can send logs', async () => {
    const res = await exports.default.fetch('http://localhost/v1/logs', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
  });

  it('rate limits per token', async () => {
    const cookie = await signInOwner();
    const { token } = await createProjectWithSource(cookie);
    // The limiter counts approximately, so keep sending batches until it pushes back (limit is 1,200/min).
    let limited = false;
    for (let sent = 0; sent < 5000 && !limited; sent += 500) {
      const statuses = await Promise.all(
        Array.from({ length: 500 }, () => ingest(token, '').then((r) => r.status)),
      );
      limited = statuses.includes(429);
    }
    expect(limited).toBe(true);
  });
});
