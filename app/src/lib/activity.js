// Whether logs are arriving: one rule for sources and projects, so every screen says the same thing.

/** A source or project counts as live while its newest event is under 15 minutes old. */
export const LIVE_MS = 15 * 60 * 1000;

/**
 * @param {number | null | undefined} lastEventAt
 * @param {number} [now]
 * @returns {{ state: 'waiting' | 'live' | 'idle', label: string }}
 */
export function activity(lastEventAt, now = Date.now()) {
  if (!lastEventAt) return { state: 'waiting', label: 'Waiting for first event' };
  if (now - lastEventAt < LIVE_MS) return { state: 'live', label: 'Live' };
  return { state: 'idle', label: 'Idle' };
}
