// Dashboard charts: number (with trend), bar, stacked bar, line and donut. SVG/DOM only.
import { Link } from 'react-router';
import { compact, hm, num } from '../lib/format.js';

const LEVEL_ORDER = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVELS = new Set(LEVEL_ORDER);
const PALETTE = ['c1', 'c2', 'c3', 'c4', 'c5'];

/**
 * @typedef {{ t: number, value: number }} Point
 * @typedef {{ value: number | null, groups: { key: string, value: number }[], series: Point[], series_by_group: { key: string, series: Point[] }[], interval_ms: number }} Agg
 * @typedef {{ title: string, field: string | null, measure: string, viz: string, filter: { where: any[] } }} ChartDef
 */

/** Colour class for a group key: level colours for levels, palette otherwise. @param {string} key @param {number} i @param {string | null} field */
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

/** @param {ChartDef} c @param {number | null} v */
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

/** @param {{ series: Point[], bad: boolean }} props */
function Spark({ series, bad }) {
  const vals = series.map((p) => p.value);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pts =
    vals.length < 2
      ? ''
      : vals
          .map(
            (v, i) =>
              `${Math.round((i * 96) / (vals.length - 1))},${27 - Math.round(((v - min) / (max - min || 1)) * 24)}`,
          )
          .join(' ');
  return (
    <svg className={`spark${bad ? ' bad' : ''}`} viewBox="0 0 96 30" aria-hidden="true">
      {pts && <polyline points={pts} />}
    </svg>
  );
}

/** @param {{ max: number }} props */
function YAxis({ max }) {
  return (
    <div className="yaxis" aria-hidden="true">
      <span>{compact(max)}</span>
      <span>{max >= 4 ? compact(max / 2) : ''}</span>
      <span>0</span>
    </div>
  );
}

/** @param {{ series: Point[], wide: boolean }} props */
function XLabels({ series, wide }) {
  if (!series.length) return <div className="xaxis" />;
  const first = series[0].t;
  const last = series[series.length - 1].t;
  return (
    <div className="xaxis" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i}>{hm(first + ((last - first) * i) / 3, wide)}</span>
      ))}
    </div>
  );
}

/** @param {{ c: ChartDef, data: Agg, prev: Agg | null }} props */
function NumberChart({ c, data, prev }) {
  const bad = upIsBad(c);
  let delta = <span className="delta">No data for the previous period</span>;
  let worse = false;
  if (prev?.value && data.value !== null) {
    const pct = Math.round(((data.value - prev.value) / prev.value) * 100);
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
    const judged = bad && pct !== 0;
    worse = judged && pct > 0;
    delta = (
      <span
        className={`delta${judged ? (pct > 0 ? ' bad' : ' good') : ''}`}
      >{`${arrow} ${Math.abs(pct)}% vs previous period${judged ? (pct > 0 ? ' · worse' : ' · better') : ''}`}</span>
    );
  }
  return (
    <>
      <div className="bigrow">
        <span className={`big${worse ? ' bad' : ''}`} data-testid="chart-value">
          {formatValue(c, data.value)}
        </span>
        <Spark series={data.series} bad={worse} />
      </div>
      {delta}
    </>
  );
}

/** @param {{ c: ChartDef, data: Agg, linkFor: (key: string) => string | null }} props */
function HorizontalBars({ c, data, linkFor }) {
  const max = Math.max(1, ...data.groups.map((g) => g.value));
  const errors = c.field === 'message';
  return (
    <div className="hbars">
      {data.groups.slice(0, 8).map((g) => {
        const href = linkFor(g.key);
        const body = (
          <>
            <span>{g.key}</span>
            <div className="track">
              <div style={{ width: `${Math.round((g.value / max) * 100)}%` }} />
            </div>
            <b>{formatValue(c, g.value)}</b>
          </>
        );
        const cls = `hbar${errors ? ' errors' : ''}`;
        return href ? (
          <Link key={g.key} className={cls} to={href} title={g.key}>
            {body}
          </Link>
        ) : (
          <div key={g.key} className={cls} title={g.key}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** @param {{ c: ChartDef, data: Agg }} props */
function StackedBars({ c, data }) {
  const groups = data.series_by_group.length
    ? byLevel(c, data.series_by_group)
    : [{ key: c.title, series: data.series }];
  const n = groups[0].series.length;
  const totals = Array.from({ length: n }, (_, i) =>
    groups.reduce((sum, g) => sum + (g.series[i]?.value ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const range = (groups[0].series.at(-1)?.t ?? 0) - (groups[0].series[0]?.t ?? 0);
  return (
    <>
      <div className="vplot">
        <YAxis max={max} />
        <div className="vbars" role="img" aria-label={`${c.title} over time`}>
          {Array.from({ length: n }, (_, i) => {
            const t = groups[0].series[i].t;
            return (
              <div
                key={t}
                className="col"
                title={`${hm(t)} UTC  ${groups.map((g) => `${g.key} ${g.series[i]?.value ?? 0}`).join(' · ')}`}
              >
                {groups.map((g) => {
                  const v = g.series[i]?.value ?? 0;
                  if (!v) return null;
                  const gi = data.series_by_group.findIndex((x) => x.key === g.key);
                  return (
                    <span
                      key={g.key}
                      className={data.series_by_group.length ? colorOf(g.key, gi, c.field) : 'k-one'}
                      style={{ height: `${(v / max) * 100}%` }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <XLabels series={groups[0].series} wide={range > 86_400_000} />
    </>
  );
}

/** @param {{ c: ChartDef, data: Agg }} props */
function LineChart({ c, data }) {
  const lines =
    data.series_by_group.length && c.measure !== 'count'
      ? data.series_by_group
      : [{ key: c.title, series: data.series }];
  const all = lines.flatMap((l) => l.series);
  if (!all.length) return <div className="nodata">No numeric values in this range</div>;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const max = Math.max(1, ...all.map((p) => p.value));
  return (
    <>
      <div className="vplot">
        <YAxis max={max} />
        <div className="grow">
          <svg
            className="line-svg"
            viewBox="0 0 300 134"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${c.title} over time`}
          >
            {lines.map((l, i) => (
              <polyline
                key={l.key}
                className={
                  lines.length > 1
                    ? colorOf(l.key, i, c.measure === 'count_over_time' ? c.field : null)
                    : 'k-one'
                }
                points={l.series
                  .map((p) => `${((p.t - t0) / (t1 - t0 || 1)) * 300},${130 - (p.value / max) * 126}`)
                  .join(' ')}
              />
            ))}
          </svg>
        </div>
      </div>
      <XLabels series={lines[0].series} wide={t1 - t0 > 86_400_000} />
    </>
  );
}

/** @param {{ c: ChartDef, data: Agg }} props */
function Donut({ c, data }) {
  const top = data.groups.slice(0, 4);
  const counting = c.measure === 'count' || c.measure === 'count_over_time';
  const total = counting ? (data.value ?? 0) : top.reduce((n, g) => n + g.value, 0);
  const rest = Math.max(0, total - top.reduce((n, g) => n + g.value, 0));
  const parts = [
    ...top.map((g, i) => ({ key: g.key, value: g.value, cls: colorOf(g.key, i, c.field) })),
    ...(rest ? [{ key: 'other', value: rest, cls: 'k-other' }] : []),
  ];
  const pct = (/** @type {number} */ v) => (v / (total || 1)) * 100;
  let offset = 0;
  const lead = parts[0];
  return (
    <div className="donut">
      <svg
        viewBox="0 0 42 42"
        role="img"
        aria-label={parts.map((p) => `${p.key} ${Math.round(pct(p.value))} percent`).join(', ')}
      >
        {parts.map((p) => {
          const share = pct(p.value);
          const circle = (
            <circle
              key={p.key}
              className={p.cls}
              cx="21"
              cy="21"
              r="15.915"
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-offset}
            />
          );
          offset += share;
          return circle;
        })}
      </svg>
      <div className="center">
        <b>{lead ? `${Math.round(pct(lead.value) * 10) / 10}%` : '—'}</b>
        <span>{lead ? lead.key : 'no data'}</span>
      </div>
      <div className="keys">
        {parts.map((p) => (
          <span key={p.key}>
            <i className={p.cls} />
            {p.key}
            <b>{formatValue(c, p.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Chart body for a tile or the builder preview.
 * @param {{ c: ChartDef, data: Agg, prev?: Agg | null, linkFor?: (key: string) => string | null }} props
 */
export function Chart({ c, data, prev = null, linkFor = () => null }) {
  if (c.viz === 'number') return <NumberChart c={c} data={data} prev={prev} />;
  const empty =
    !data.groups.length &&
    data.series.every((p) => !p.value) &&
    data.series_by_group.every((g) => g.series.every((p) => !p.value));
  if (empty) return <div className="nodata">No events in this range</div>;
  const hasGroups = data.groups.length > 0;
  if (c.viz === 'pie')
    return hasGroups ? <Donut c={c} data={data} /> : <div className="nodata">Pick a field to split by</div>;
  if (c.viz === 'line') return <LineChart c={c} data={data} />;
  if (c.measure === 'count_over_time' || !hasGroups) return <StackedBars c={c} data={data} />;
  return <HorizontalBars c={c} data={data} linkFor={linkFor} />;
}

/** Legend for multi-series charts (shown in the tile header). @param {{ c: ChartDef, data: Agg }} props */
export function Legend({ c, data }) {
  const multi =
    (c.viz === 'bar' && c.measure === 'count_over_time') || (c.viz === 'line' && c.measure !== 'count');
  if (!multi || data.series_by_group.length < 2) return null;
  return (
    <span className="keys">
      {byLevel(c, data.series_by_group).map((g) => (
        <span key={g.key}>
          <i className={colorOf(g.key, data.series_by_group.indexOf(g), c.field)} />
          {g.key}
        </span>
      ))}
    </span>
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
