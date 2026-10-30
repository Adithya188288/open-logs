import { describe, expect, it } from 'vitest';
import { activity, LIVE_MS } from '../../app/src/lib/activity.js';
import { eventTime, needsDate } from '../../app/src/lib/format.js';

describe('source and project activity', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  it('is waiting before the first event, live within 15 minutes, idle after', () => {
    expect(activity(null, now)).toEqual({ state: 'waiting', label: 'Waiting for first event' });
    expect(activity(now - LIVE_MS + 1000, now)).toEqual({ state: 'live', label: 'Live' });
    expect(activity(now - LIVE_MS - 1000, now)).toEqual({ state: 'idle', label: 'Idle' });
  });
});

describe('event time column', () => {
  const ts = Date.UTC(2026, 9, 29, 23, 59, 58, 7);
  it('shows the time alone, or the date and time when the range needs it', () => {
    expect(eventTime(ts, false)).toBe('23:59:58.007');
    expect(eventTime(ts, true)).toBe('Oct 29 23:59:58.007');
  });
  it('needs the date when the range is longer than a day or crosses midnight UTC', () => {
    const noon = Date.UTC(2026, 9, 30, 12, 0, 0);
    expect(needsDate({ from: noon - 15 * 60_000, to: noon })).toBe(false);
    expect(needsDate({ from: Date.UTC(2026, 9, 29, 23, 50), to: Date.UTC(2026, 9, 30, 0, 5) })).toBe(true);
    expect(needsDate({ from: noon - 7 * 86_400_000, to: noon })).toBe(true);
  });
});
