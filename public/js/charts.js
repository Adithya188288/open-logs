// Chart rendering for dashboard tiles: number, bar, pie (donut), line. SVG/DOM only, text via textContent.
import { h, s } from './dom.js';
import { compact, hm, num } from './format.js';

const LEVEL_ORDER = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVELS = new Set(LEVEL_ORDER);
const PALETTE = ['c1', 'c2', 'c3', 'c4', 'c5'];

/**
 * @typedef {{ t: number, value: number }} Point
 * @typedef {{ value: number | null, groups: { key: string, value: number }[], series: Point[], series_by_group: { key: string, series: Point[] }[], interval_ms: number }} Agg
 * @typedef {{ title: string, field: string | null, measure: string, viz: string, filter: { where: any[] } }} ChartDef
 */

/**
 * Colour class for a group key: level colours for levels, palette otherwise.
 * @param {string} key
 * @param {number} i
 * @param {string | null} field
 */
export function colorOf(key, i, field) {
  if (field === 'level' && LEVELS.has(key)) return `k-${key}`;
  return `k-${PALETTE[i % PALETTE.length]}`;
}

/**
 * Levels stack and list in severity order; other groups keep their size order.
 * @template {{ key: string }} G
 * @param {ChartDef} c
 * @param {G[]} groups
 */
function byLevel(c, groups) {
  if (c.field !== 'level') return groups;
  return [...groups].sort((a, b) => LEVEL_ORDER.indexOf(a.key) - LEVEL_ORDER.indexOf(b.key));
}

/** @param {ChartDef} c */
function unitOf(c) {
  if (c.measure !== 'avg' && c.measure !== 'p95') return '';
  return /(_ms|ms|latency|duration)$/i.test(c.field ?? '') ? ' ms' : '';
}

/**
 * @param {ChartDef} c
 * @param {number | null} v
 */
export function formatValue(c, v) {
  if (v === null || v === undefined) return '—';
  if (c.measure === 'avg' || c.measure === 'p95') return `${num(v)}${unitOf(c)}`;
  return num(v);
}

/** Rising is bad for errors and latency; neutral otherwise. @param {ChartDef} c */
function upIsBad(c) {
  if (c.measure === 'avg' || c.measure === 'p95') return true;
  return c.filter.where.some(
    (w) => w.field === 'level' && [].concat(w.value).some((v) => v === 'error' || v === 'fatal'),
  );
}

/**
 * @param {Point[]} series
 * @param {boolean} bad
 */
function spark(series, bad) {
  const vals = series.map((p) => p.value);
  const svg = s('svg', { class: `spark${bad ? ' bad' : ''}`, viewBox: '0 0 96 30', 'aria-hidden': 'true' });
  if (vals.length < 2) return svg;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pts = vals.map(
    (v, i) =>
      `${Math.round((i * 96) / (vals.length - 1))},${27 - Math.round(((v - min) / (max - min || 1)) * 24)}`,
  );
  svg.append(s('polyline', { points: pts.join(' ') }));
  return svg;
}

/**
 * @param {ChartDef} c
 * @param {Agg} data
 * @param {Agg | null} prev  same chart over the previous period
 */
function numberChart(c, data, prev) {
  const bad = upIsBad(c);
  let delta = h('span.delta', null, 'No data for the previous period');
  let worse = false;
  if (prev?.value && data.value !== null) {
    const pct = Math.round(((data.value - prev.value) / prev.value) * 100);
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
    const judged = bad && pct !== 0;
    worse = judged && pct > 0;
    const verdict = judged ? (pct > 0 ? ' · worse' : ' · better') : '';
    delta = h(
      `span.delta${judged ? (pct > 0 ? '.bad' : '.good') : ''}`,
      null,
      `${arrow} ${Math.abs(pct)}% vs previous period${verdict}`,
    );
  }
  return [
    h(
      'div.bigrow',
      null,
      h(`span.big${worse ? '.bad' : ''}`, { 'data-testid': 'chart-value' }, formatValue(c, data.value)),
      spark(data.series, worse),
    ),
    delta,
  ];
}

/**
 * @param {ChartDef} c
 * @param {Agg} data
 * @param {(key: string) => string | null} linkFor
 */
function horizontalBars(c, data, linkFor) {
  const max = Math.max(1, ...data.groups.map((g) => g.value));
  const errors = c.field === 'message';
  return h(
    'div.hbars',
    null,
    ...data.groups.slice(0, 8).map((g) => {
      const fill = h('div');
      fill.style.width = `${Math.round((g.value / max) * 100)}%`;
      const href = linkFor(g.key);
      return h(
        `${href ? 'a' : 'div'}.hbar${errors ? '.errors' : ''}`,
        { href, title: g.key },
        h('span', null, g.key),
        h('div.track', null, fill),
        h('b', null, formatValue(c, g.value)),
      );
    }),
  );
}

/**
 * @param {Point[]} series
 * @param {boolean} wide
 */
function xLabels(series, wide) {
  if (!series.length) return h('div.xaxis');
  const first = series[0].t;
  const last = series[series.length - 1].t;
  return h(
    'div.xaxis',
    { 'aria-hidden': 'true' },
    ...[0, 1, 2, 3].map((i) => h('span', null, hm(first + ((last - first) * i) / 3, wide))),
  );
}

/**
 * @param {ChartDef} c
 * @param {Agg} data
 */
function stackedBars(c, data) {
  const groups = data.series_by_group.length
    ? byLevel(c, data.series_by_group)
    : [{ key: c.title, series: data.series }];
  const n = groups[0].series.length;
  const totals = Array.from({ length: n }, (_, i) =>
    groups.reduce((sum, g) => sum + (g.series[i]?.value ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const cols = Array.from({ length: n }, (_, i) => {
    const t = groups[0].series[i].t;
    const col = h('div.col', {
      title: `${hm(t)} UTC  ${groups.map((g) => `${g.key} ${g.series[i]?.value ?? 0}`).join(' · ')}`,
    });
    groups.forEach((g) => {
      const v = g.series[i]?.value ?? 0;
      if (!v) return;
      const gi = data.series_by_group.findIndex((x) => x.key === g.key);
      const seg = h(`span.${data.series_by_group.length ? colorOf(g.key, gi, c.field) : 'k-one'}`);
      seg.style.height = `${(v / max) * 100}%`;
      col.append(seg);
    });
    return col;
  });
  const range = (groups[0].series.at(-1)?.t ?? 0) - (groups[0].series[0]?.t ?? 0);
  return [
    h(
      'div.vplot',
      null,
      h(
        'div.yaxis',
        { 'aria-hidden': 'true' },
        h('span', null, compact(max)),
        h('span', null, compact(max / 2)),
        h('span', null, '0'),
      ),
      h('div.vbars', { role: 'img', 'aria-label': `${c.title} over time` }, ...cols),
    ),
    xLabels(groups[0].series, range > 86_400_000),
  ];
}

/**
 * @param {ChartDef} c
 * @param {Agg} data
 */
function lineChart(c, data) {
  const lines =
    data.series_by_group.length && c.measure !== 'count'
      ? data.series_by_group
      : [{ key: c.title, series: data.series }];
  const all = lines.flatMap((l) => l.series);
  if (!all.length) return [h('div.nodata', null, 'No numeric values in this range')];
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const max = Math.max(1, ...all.map((p) => p.value));
  const svg = s('svg', {
    class: 'line-svg',
    viewBox: '0 0 300 134',
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `${c.title} over time`,
  });
  lines.forEach((l, i) => {
    const pts = l.series.map((p) => `${((p.t - t0) / (t1 - t0 || 1)) * 300},${130 - (p.value / max) * 126}`);
    svg.append(
      s('polyline', {
        class:
          lines.length > 1 ? colorOf(l.key, i, c.measure === 'count_over_time' ? c.field : null) : 'k-one',
        points: pts.join(' '),
      }),
    );
  });
  return [
    h(
      'div.vplot',
      null,
      h(
        'div.yaxis',
        { 'aria-hidden': 'true' },
        h('span', null, compact(max)),
        h('span', null, compact(max / 2)),
        h('span', null, '0'),
      ),
      h('div', { class: 'grow' }, svg),
    ),
    xLabels(lines[0].series, t1 - t0 > 86_400_000),
  ];
}

/**
 * @param {ChartDef} c
 * @param {Agg} data
 */
function donut(c, data) {
  const top = data.groups.slice(0, 4);
  const counting = c.measure === 'count' || c.measure === 'count_over_time';
  const total = counting ? (data.value ?? 0) : top.reduce((n, g) => n + g.value, 0);
  const rest = Math.max(0, total - top.reduce((n, g) => n + g.value, 0));
  const parts = [
    ...top.map((g, i) => ({ key: g.key, value: g.value, cls: colorOf(g.key, i, c.field) })),
    ...(rest ? [{ key: 'other', value: rest, cls: 'k-other' }] : []),
  ];
  const svg = s('svg', {
    viewBox: '0 0 42 42',
    role: 'img',
    'aria-label': parts
      .map((p) => `${p.key} ${Math.round((p.value / (total || 1)) * 100)} percent`)
      .join(', '),
  });
  let offset = 0;
  for (const p of parts) {
    const pct = (p.value / (total || 1)) * 100;
    svg.append(
      s('circle', {
        class: p.cls,
        cx: 21,
        cy: 21,
        r: 15.915,
        'stroke-dasharray': `${pct} ${100 - pct}`,
        'stroke-dashoffset': -offset,
      }),
    );
    offset += pct;
  }
  const lead = parts[0];
  return h(
    'div.donut',
    null,
    svg,
    h(
      'div.center',
      null,
      h('b', null, lead ? `${Math.round((lead.value / (total || 1)) * 1000) / 10}%` : '—'),
      h('span', null, lead ? lead.key : 'no data'),
    ),
    h(
      'div.keys',
      null,
      ...parts.map((p) => h('span', null, h(`i.${p.cls}`), p.key, h('b', null, formatValue(c, p.value)))),
    ),
  );
}

/**
 * Chart body for a tile or the builder preview.
 * @param {ChartDef} c
 * @param {Agg} data
 * @param {{ prev?: Agg | null, linkFor?: (key: string) => string | null }} [opts]
 * @returns {Node[]}
 */
export function renderChart(c, data, opts = {}) {
  const linkFor = opts.linkFor ?? (() => null);
  if (c.viz === 'number') return numberChart(c, data, opts.prev ?? null);
  const hasGroups = data.groups.length > 0;
  if (c.viz === 'pie')
    return hasGroups ? [donut(c, data)] : [h('div.nodata', null, 'Pick a field to split by')];
  if (c.viz === 'line') return lineChart(c, data);
  if (c.measure === 'count_over_time' || !hasGroups) return stackedBars(c, data);
  return [horizontalBars(c, data, linkFor)];
}

/**
 * Legend chips for multi-series charts (shown in the tile header).
 * @param {ChartDef} c
 * @param {Agg} data
 */
export function legendFor(c, data) {
  const multi =
    (c.viz === 'bar' && c.measure === 'count_over_time') || (c.viz === 'line' && c.measure !== 'count');
  if (!multi || data.series_by_group.length < 2) return null;
  return h(
    'span.keys',
    null,
    ...byLevel(c, data.series_by_group).map((g) =>
      h('span', null, h(`i.${colorOf(g.key, data.series_by_group.indexOf(g), c.field)}`), g.key),
    ),
  );
}

/**
 * CSV rows for a chart.
 * @param {ChartDef} c
 * @param {Agg} data
 * @returns {unknown[][]}
 */
export function csvRows(c, data) {
  if (c.viz === 'number') return [[c.title, 'value', data.value]];
  if (c.viz === 'line' || c.measure === 'count_over_time' || !data.groups.length) {
    const groups = data.series_by_group.length ? data.series_by_group : [{ key: 'all', series: data.series }];
    return groups.flatMap((g) =>
      g.series.map((p) => [c.title, `${new Date(p.t).toISOString()} ${g.key}`, p.value]),
    );
  }
  return data.groups.map((g) => [c.title, g.key, g.value]);
}
