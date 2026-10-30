import { describe, expect, it } from 'vitest';
import { normalizeEvent, normalizeLevel } from '../../src/ingest/normalize.js';

const NOW = Date.UTC(2026, 9, 30, 10, 0, 0);
const source = { project_id: 'prj_a', name: 'api' };

describe('normalizeLevel', () => {
  it('maps common spellings and numeric levels', () => {
    expect(normalizeLevel('WARNING')).toBe('warn');
    expect(normalizeLevel('err')).toBe('error');
    expect(normalizeLevel('critical')).toBe('fatal');
    expect(normalizeLevel('trace')).toBe('debug');
    expect(normalizeLevel(50)).toBe('error');
    expect(normalizeLevel(30)).toBe('info');
    expect(normalizeLevel('nonsense')).toBe('info');
    expect(normalizeLevel(undefined)).toBe('info');
  });
});

describe('normalizeEvent', () => {
  it('stamps project and source from the token, never the body', () => {
    const e = normalizeEvent({ message: 'hi', project_id: 'prj_evil', source: 'evil' }, source, NOW);
    expect(e.project_id).toBe('prj_a');
    expect(e.source).toBe('api');
    expect(JSON.parse(e.fields)).toEqual({});
  });

  it('keeps every other key as a field', () => {
    const e = normalizeEvent(
      { msg: 'payment failed', level: 'error', order_id: 4821, nested: { a: 1 } },
      source,
      NOW,
    );
    expect(e).toMatchObject({ message: 'payment failed', level: 'error' });
    expect(JSON.parse(e.fields)).toEqual({ order_id: 4821, nested: { a: 1 } });
    expect(e.id).toMatch(/^[0-9a-f]{12}[a-z0-9]{8}$/);
  });

  it('accepts client time in ms, seconds or ISO within ±24h, else uses server time', () => {
    expect(normalizeEvent({ ts: NOW - 1000 }, source, NOW).ts).toBe(NOW - 1000);
    expect(normalizeEvent({ timestamp: (NOW - 5000) / 1000 }, source, NOW).ts).toBe(NOW - 5000);
    expect(normalizeEvent({ ts: String((NOW - 5000) / 1000) }, source, NOW).ts).toBe(NOW - 5000);
    expect(normalizeEvent({ ts: String(NOW - 5000) }, source, NOW).ts).toBe(NOW - 5000);
    expect(normalizeEvent({ dt: new Date(NOW - 60_000).toISOString() }, source, NOW).ts).toBe(NOW - 60_000);
    expect(normalizeEvent({ ts: NOW - 2 * 86_400_000 }, source, NOW).ts).toBe(NOW);
    expect(normalizeEvent({ ts: 'garbage' }, source, NOW).ts).toBe(NOW);
  });

  it('stringifies non-string messages', () => {
    expect(normalizeEvent({ message: { a: 1 } }, source, NOW).message).toBe('{"a":1}');
    expect(normalizeEvent({}, source, NOW).message).toBe('');
  });
});
