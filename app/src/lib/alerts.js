// Shared wording and options for chart alerts.
import { clauseToSearch } from './search.js';

export const WINDOWS = [5, 15, 30, 45, 60];
/** Quiet time after an incident resolves: 5 or 15 minutes, or 1 to 24 hours. */
export const QUIET = [5, 15, ...Array.from({ length: 24 }, (_, i) => (i + 1) * 60)];

/** @param {number} minutes */
export function quietLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
}

/** What the chart (and so its alert) measures. @param {{ measure: string, field?: string | null }} c */
export function measureLabel(c) {
  const field = String(c.field ?? '').replace(/^fields\./, '');
  if (c.measure === 'avg') return `Average ${field}`;
  if (c.measure === 'p95') return `p95 ${field}`;
  return 'Number of logs';
}

/** A chart's filter as search text, e.g. `level:error source:api`. @param {any[]} where */
export function filterText(where) {
  return where.map((w) => ('text' in w ? w.text : clauseToSearch(w))).join(' ');
}

export const RESOLVED_BY = /** @type {Record<string, string>} */ ({
  auto: 'automatically',
  manual: 'by hand',
  paused: 'when the alert was paused',
});

/** @param {{ paused: boolean, open_incident?: unknown, open?: boolean }} a @returns {'paused' | 'open' | 'ok'} */
export function alertStatus(a) {
  if (a.paused) return 'paused';
  return a.open_incident || a.open ? 'open' : 'ok';
}
