// Formatting helpers. All times are shown in UTC, like the design.

/** @param {number} n */
export function num(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** 84120 → "84.1k" @param {number} n */
export function compact(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** @param {number} n */
function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

/** "10:42:18" @param {number} ts */
export function hms(ts) {
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** "10:42:18.204" @param {number} ts */
export function hmsms(ts) {
  return `${hms(ts)}.${pad(new Date(ts).getUTCMilliseconds(), 3)}`;
}

/** "10:42:18.204", or "Oct 30 10:42:18.204" when the range needs the date @param {number} ts @param {boolean} withDate */
export function eventTime(ts, withDate) {
  if (!withDate) return hmsms(ts);
  const d = new Date(ts);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${hmsms(ts)}`;
}

/** A time column needs dates when its range is longer than a day or crosses midnight UTC. @param {{ from: number, to: number }} w */
export function needsDate(w) {
  return w.to - w.from > 86_400_000 || new Date(w.from).getUTCDate() !== new Date(w.to).getUTCDate();
}

/** "10:42" or "Oct 30 10:42" for longer ranges @param {number} ts @param {boolean} [withDate] */
export function hm(ts, withDate = false) {
  const d = new Date(ts);
  const t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (!withDate) return t;
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${t}`;
}

/** "4s ago", "2h ago" @param {number} ts @param {number} [now] */
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Initials for an avatar. @param {string} name */
export function initials(name) {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** @param {string} s */
export function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "~1–3 min" style label for the Basin ingest lag. @param {number} ms */
export function lagLabel(ms) {
  if (ms < 90_000) return `~${Math.round(ms / 1000)}s`;
  return `~1–${Math.round(ms / 60_000)} min`;
}

/** Duration label for a range in ms. @param {number} ms */
export function span(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} days`;
}
