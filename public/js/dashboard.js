// Dashboards: chart tiles, chart builder drawer, pin / edit / duplicate / remove, CSV export per chart.
import { api, ApiError } from './api.js';
import { csvRows, formatValue, legendFor, renderChart } from './charts.js';
import { downloadCsv, toCsv } from './csv.js';
import { confirmDelete, formDialog, h, icon, mount, popMenu, toast } from './dom.js';
import { hms, num } from './format.js';
import { clauseToSearch, fieldFor, parseSearch } from './search.js';
import { page, topbar } from './shell.js';

const RANGES = { '15m': 15 * 60_000, '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };
const MEASURES = [
  ['count', 'Count'],
  ['count_over_time', 'Count over time'],
  ['avg', 'Average'],
  ['p95', 'p95'],
];
const VIZ = ['bar', 'pie', 'line', 'number'];

/** @typedef {import('./charts.js').ChartDef & { id: string, size: string }} Chart */

let project = /** @type {any} */ (null);
let dashboard = /** @type {any} */ (null);
/** @type {any[]} */
let dashboards = [];
/** @type {Chart[]} */
let charts = [];
/** @type {keyof typeof RANGES} */
let range = '1h';
/** @type {Map<string, any>} */
const results = new Map();
let lag = 0;

const tilesEl = h('div.tiles', { 'data-testid': 'tiles' });
const metaEl = h('span.small.muted');
const rangesEl = h('div.seg', { role: 'group', 'aria-label': 'Time range' });
const titleBtn = h('button.titlebtn', {
  type: 'button',
  'aria-haspopup': 'menu',
  'data-testid': 'dashboard-switcher',
});

function windowRange() {
  const to = Date.now() + 1000;
  return { from: to - RANGES[range], to };
}

/**
 * Which parts of an aggregate a chart actually draws. Each part is a Basin query (min 10 MB billed),
 * so asking only for these keeps a dashboard load cheap.
 * @param {Pick<Chart, 'field' | 'measure' | 'viz'>} c
 */
function partsFor(c) {
  const grouped = Boolean(c.field) || c.measure === 'avg' || c.measure === 'p95';
  if (c.viz === 'number') return ['value', 'series'];
  if (c.viz === 'pie') return ['value', 'groups'];
  if (c.viz === 'line') return grouped && c.measure !== 'count' ? ['series', 'series_by_group'] : ['series'];
  if (c.measure === 'count_over_time') return c.field ? ['series', 'series_by_group'] : ['series'];
  return grouped ? ['groups'] : ['series'];
}

/**
 * @param {Pick<Chart, 'filter' | 'field' | 'measure' | 'viz'>} c
 * @param {{ from: number, to: number }} w
 * @param {string[]} [parts]
 */
function aggregate(c, w, parts = partsFor(c)) {
  return api('/api/aggregate', {
    body: {
      project_id: project.id,
      ...w,
      where: c.filter.where,
      measure: c.measure,
      field: c.field ?? undefined,
      parts,
    },
  });
}

/** Link from a group key to the live tail filtered on it. @param {Chart} c */
function tailLink(c) {
  return (/** @type {string} */ key) => {
    if (!c.field) return null;
    const q = [
      ...c.filter.where.map((w) => ('text' in w ? w.text : clauseToSearch(w))),
      clauseToSearch({ field: c.field, op: '=', value: key }),
    ].join(' ');
    return `/tail?project=${encodeURIComponent(project.id)}&range=${range}&q=${encodeURIComponent(q)}`;
  };
}

/** @param {Chart} c */
async function loadChart(c) {
  const w = windowRange();
  const span = w.to - w.from;
  const [data, prev] = await Promise.all([
    aggregate(c, w),
    c.viz === 'number' ? aggregate(c, { from: w.from - span, to: w.from }, ['value']) : null,
  ]);
  results.set(c.id, { data, prev });
  return { data, prev };
}

/** @param {Chart} c */
function tile(c) {
  const el = h(`section.tile.${c.size}`, { 'data-testid': 'chart', 'aria-label': c.title });
  const more = h(
    'button.more',
    { type: 'button', 'aria-label': `Chart options for ${c.title}`, 'aria-haspopup': 'menu' },
    '⋯',
  );
  more.addEventListener('click', () =>
    popMenu(more, [
      h('button', { type: 'button', role: 'menuitem', onclick: () => openDrawer(c) }, 'Edit'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => duplicate(c) }, 'Duplicate'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => exportChart(c) }, 'Export CSV'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => remove(c) }, 'Remove'),
    ]),
  );
  const head = h('div.head', null, h('h2', null, c.title), h('div.headr', null, more));
  const body = h('div.body', null, h('div.nodata', null, 'Loading…'));
  el.append(head, body);
  loadChart(c)
    .then(({ data, prev }) => {
      const legend = legendFor(c, data);
      if (legend) head.lastElementChild?.prepend(legend);
      mount(body, ...renderChart(c, data, { prev, linkFor: tailLink(c) }));
    })
    .catch((err) =>
      mount(
        body,
        h('p.err', { role: 'alert' }, err instanceof ApiError ? err.message : 'Could not load this chart'),
      ),
    );
  return el;
}

function renderTiles() {
  results.clear();
  if (!charts.length) {
    mount(
      tilesEl,
      h(
        'div.empty-board',
        null,
        h('h2', null, 'No charts yet'),
        h('p.small', null, 'Build a chart from any filter and pin it here.'),
        h('button.btn.primary', { type: 'button', onclick: () => openDrawer() }, '+ Add chart'),
      ),
    );
  } else mount(tilesEl, ...charts.map(tile));
  const w = windowRange();
  metaEl.textContent = `${charts.length} chart${charts.length === 1 ? '' : 's'} · data through ${hms(w.to - 1000 - lag)} UTC`;
}

function renderRanges() {
  mount(
    rangesEl,
    ...Object.keys(RANGES).map((r) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(r === range),
          onclick: () => {
            range = /** @type {keyof typeof RANGES} */ (r);
            renderRanges();
            renderTiles();
          },
        },
        r,
      ),
    ),
  );
}

function renderSwitcher() {
  mount(titleBtn, h('h1', null, dashboard.name), icon('chevron', 16));
}

function dashboardMenu() {
  const here = (/** @type {any} */ d) =>
    `/dashboard?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(d.id)}`;
  popMenu(
    titleBtn,
    [
      h('div.menu-label', null, 'Dashboards'),
      ...dashboards.map((d) =>
        h(
          'a',
          {
            href: here(d),
            role: 'menuitem',
            'aria-current': d.id === dashboard.id ? 'true' : null,
            'data-testid': 'dashboard-link',
          },
          d.name,
        ),
      ),
      h('hr'),
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: newDashboard },
        icon('plus', 14),
        'New dashboard',
      ),
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: renameDashboard },
        icon('edit', 14),
        'Rename this dashboard',
      ),
      dashboards.length > 1
        ? h(
            'button.danger',
            { type: 'button', role: 'menuitem', onclick: deleteDashboard },
            icon('x', 14),
            'Delete this dashboard',
          )
        : null,
    ].filter(Boolean),
  );
}

async function newDashboard() {
  const input = h('input.input#dname', {
    name: 'name',
    required: true,
    maxlength: 60,
    placeholder: 'Payments',
  });
  await formDialog(
    'New dashboard',
    [h('div.field', null, h('label.label', { for: 'dname' }, 'Name'), input)],
    'Create dashboard',
    async (v) => {
      try {
        const { dashboard: d } = await api(`/api/projects/${project.id}/dashboards`, {
          body: { name: v.name },
        });
        location.href = `/dashboard?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(d.id)}`;
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Could not create the dashboard';
      }
    },
  );
}

async function renameDashboard() {
  const input = h('input.input#rname', {
    name: 'name',
    required: true,
    maxlength: 60,
    value: dashboard.name,
  });
  const v = await formDialog(
    'Rename dashboard',
    [h('div.field', null, h('label.label', { for: 'rname' }, 'Name'), input)],
    'Rename',
  );
  if (!v) return;
  await api(`/api/dashboards/${dashboard.id}`, { method: 'PATCH', body: { name: v.name } });
  location.reload();
}

async function deleteDashboard() {
  await confirmDelete({
    title: `Delete dashboard ${dashboard.name}?`,
    body: 'Its charts are deleted too. Logs are not affected.',
    confirmLabel: 'Delete dashboard',
    onConfirm: async () => {
      try {
        await api(`/api/dashboards/${dashboard.id}`, { method: 'DELETE' });
        location.href = `/dashboard?project=${encodeURIComponent(project.id)}`;
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Delete failed';
      }
    },
  });
}

/** @param {Chart} c */
async function duplicate(c) {
  const { chart } = await api(`/api/charts/${c.id}/duplicate`, { method: 'POST' });
  charts = [...charts, chart];
  renderTiles();
  toast('Chart duplicated');
}

/** @param {Chart} c */
async function remove(c) {
  await confirmDelete({
    title: `Remove chart “${c.title}”?`,
    body: 'This removes the chart from the dashboard. Logs are not affected.',
    confirmLabel: 'Remove chart',
    onConfirm: async () => {
      try {
        await api(`/api/charts/${c.id}`, { method: 'DELETE' });
        charts = charts.filter((x) => x.id !== c.id);
        renderTiles();
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Remove failed';
      }
    },
  });
}

/** @param {Chart} c */
function exportChart(c) {
  const r = results.get(c.id);
  if (!r) return toast('Chart is still loading');
  downloadCsv(
    `${c.title.replace(/[^\w-]+/g, '-')}.csv`,
    toCsv(['chart', 'key', 'value'], csvRows(c, r.data)),
  );
}

/**
 * Field options for the builder: columns plus keys seen in recent events.
 * @returns {Promise<{ name: string, numeric: boolean }[]>}
 */
async function discoverFields() {
  const { events } = await api('/api/query', {
    body: { project_id: project.id, ...windowRange(), limit: 200 },
  }).catch(() => ({ events: [] }));
  /** @type {Map<string, boolean>} */
  const seen = new Map();
  const walk = (/** @type {Record<string, unknown>} */ obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v))
        walk(/** @type {Record<string, unknown>} */ (v), `${prefix}${k}.`);
      else if (seen.size < 60)
        seen.set(`fields.${prefix}${k}`, (seen.get(`fields.${prefix}${k}`) ?? true) && typeof v === 'number');
    }
  };
  for (const e of events) walk(e.fields);
  return [
    { name: 'level', numeric: false },
    { name: 'source', numeric: false },
    { name: 'message', numeric: false },
    ...[...seen].sort().map(([name, numeric]) => ({ name, numeric })),
  ];
}

/**
 * Chart builder drawer. Without `existing` it creates and pins a new chart.
 * @param {Chart} [existing]
 * @param {string} [presetField]  from "Chart" in the live tail
 */
async function openDrawer(existing, presetField) {
  const fields = await discoverFields();
  const preset = presetField
    ? (fields.find((f) => f.name === presetField) ?? { name: presetField, numeric: false })
    : null;
  const draft = {
    title:
      existing?.title ??
      (preset
        ? preset.numeric
          ? `p95 ${preset.name.replace(/^fields\./, '')}`
          : `Events by ${preset.name.replace(/^fields\./, '')}`
        : ''),
    query: existing
      ? existing.filter.where.map((w) => ('text' in w ? w.text : clauseToSearch(w))).join(' ')
      : '',
    field: existing?.field ?? preset?.name ?? '',
    measure: existing?.measure ?? (preset?.numeric ? 'p95' : 'count'),
    viz: existing?.viz ?? (preset?.numeric ? 'line' : 'bar'),
    size: existing?.size ?? 'md',
  };
  if (draft.field && !fields.some((f) => f.name === draft.field))
    fields.push({ name: draft.field, numeric: false });

  const title = /** @type {HTMLInputElement} */ (
    h('input.input#nm', { value: draft.title, maxlength: 100, required: true })
  );
  const filter = /** @type {HTMLInputElement} */ (
    h('input.input.mono#qf', { value: draft.query, placeholder: 'level:error source:worker' })
  );
  const field = /** @type {HTMLSelectElement} */ (
    h(
      'select.select#fd',
      null,
      h('option', { value: '' }, '(none)'),
      ...fields.map((f) => h('option', { value: f.name }, f.name.replace(/^fields\./, ''))),
    )
  );
  field.value = draft.field;
  const measure = /** @type {HTMLSelectElement} */ (
    h('select.select#ag', null, ...MEASURES.map(([v, label]) => h('option', { value: v }, label)))
  );
  measure.value = draft.measure;
  const vizEl = h('div.vizs', { role: 'group', 'aria-label': 'Visualization' });
  const preview = h('div.preview', { 'data-testid': 'preview' });
  const error = h('p.error-text', { role: 'alert' });

  const renderViz = () =>
    mount(
      vizEl,
      ...VIZ.map((v) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(draft.viz === v),
            onclick: () => {
              draft.viz = v;
              renderViz();
              refresh();
            },
          },
          v[0].toUpperCase() + v.slice(1),
        ),
      ),
    );

  /** Builds the chart body from the form, or returns an error message. */
  const read = () => {
    const { clauses, text } = parseSearch(filter.value);
    /** @type {any[]} */
    const where = [...clauses];
    if (text) where.push({ text });
    const f = field.value ? fieldFor(field.value) : null;
    return {
      title: title.value.trim() || 'Untitled chart',
      filter: { where },
      field: f,
      measure: measure.value,
      viz: draft.viz,
      size: draft.viz === 'number' ? 'sm' : draft.size === 'sm' ? 'md' : draft.size,
    };
  };

  let seq = 0;
  const refresh = async () => {
    const mine = ++seq;
    const c = read();
    error.textContent = '';
    if ((c.measure === 'avg' || c.measure === 'p95') && !c.field?.startsWith('fields.')) {
      mount(
        preview,
        h('span', null, 'Preview'),
        h('div.nodata', null, `${c.measure === 'avg' ? 'Average' : 'p95'} needs a numeric field`),
      );
      return;
    }
    try {
      const data = await aggregate(c, windowRange(), [...new Set([...partsFor(c), 'value'])]);
      if (mine !== seq) return;
      const counted =
        c.measure === 'count' || c.measure === 'count_over_time'
          ? ` · ${num(data.value ?? 0)} events`
          : ` · ${formatValue(c, data.value)}`;
      mount(preview, h('span', null, `Preview · last ${range}${counted}`), ...renderChart(c, data));
    } catch (err) {
      if (mine === seq)
        mount(
          preview,
          h('span', null, 'Preview'),
          h('p.err', null, err instanceof ApiError ? err.message : 'Preview failed'),
        );
    }
  };

  const save = async () => {
    const c = read();
    try {
      if (existing) {
        const { chart } = await api(`/api/charts/${existing.id}`, { method: 'PATCH', body: c });
        charts = charts.map((x) => (x.id === chart.id ? chart : x));
      } else {
        const { chart } = await api(`/api/dashboards/${dashboard.id}/charts`, { body: c });
        charts = [...charts, chart];
      }
      close();
      renderTiles();
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Could not save the chart';
    }
  };

  const drawer = h(
    'aside.drawer',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': existing ? 'Edit chart' : 'New chart' },
    h(
      'div.dhead',
      null,
      h('h2', null, existing ? 'Edit chart' : 'New chart'),
      h('button', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, '×'),
    ),
    h(
      'div.dbody',
      null,
      h('div.field', null, h('label.label', { for: 'nm' }, 'Title'), title),
      h('div.field', null, h('label.label', { for: 'qf' }, 'Filter'), filter),
      h(
        'div.two',
        null,
        h('div.field', null, h('label.label', { for: 'fd' }, 'Field'), field),
        h('div.field', null, h('label.label', { for: 'ag' }, 'Measure'), measure),
      ),
      h('div.field', null, h('span.label', null, 'Visualization'), vizEl),
      preview,
      error,
    ),
    h(
      'div.dfoot',
      null,
      h(
        'button.btn.primary',
        { type: 'button', onclick: save },
        existing ? 'Save chart' : `Pin to ${dashboard.name}`,
      ),
      h('button.btn', { type: 'button', onclick: () => close() }, 'Cancel'),
    ),
  );
  const backdrop = h(
    'div.drawer-backdrop',
    { onmousedown: (/** @type {Event} */ e) => e.target === backdrop && close() },
    drawer,
  );
  const close = () => backdrop.remove();
  drawer.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  for (const el of [filter, title]) el.addEventListener('change', refresh);
  filter.addEventListener('keydown', (e) => e.key === 'Enter' && refresh());
  field.addEventListener('change', () => {
    const f = fields.find((x) => x.name === field.value);
    if (f?.numeric && measure.value.startsWith('count')) measure.value = 'p95';
    if (!title.value) title.value = field.value ? `Events by ${field.value.replace(/^fields\./, '')}` : '';
    refresh();
  });
  measure.addEventListener('change', refresh);
  document.body.appendChild(backdrop);
  renderViz();
  refresh();
  title.focus();
}

async function main() {
  const [ctx, status] = await Promise.all([page('dashboard'), api('/api/status')]);
  project = ctx.project;
  lag = status.lag_ms;
  const params = new URLSearchParams(location.search);
  dashboards = (await api(`/api/projects/${project.id}/dashboards`)).dashboards;
  if (!dashboards.length) {
    const { dashboard: d } = await api(`/api/projects/${project.id}/dashboards`, {
      body: { name: 'Overview' },
    });
    dashboards = [d];
  }
  dashboard = dashboards.find((d) => d.id === params.get('id')) ?? dashboards[0];
  charts = (await api(`/api/dashboards/${dashboard.id}`)).charts;
  titleBtn.addEventListener('click', dashboardMenu);
  ctx.main.append(
    topbar(
      titleBtn,
      [metaEl],
      [
        rangesEl,
        h(
          'button.btn.primary',
          { type: 'button', onclick: () => openDrawer() },
          icon('plus', 14),
          'Add chart',
        ),
      ],
    ),
    tilesEl,
  );
  renderSwitcher();
  renderRanges();
  renderTiles();
  const preset = params.get('chart');
  if (preset) openDrawer(undefined, preset);
}

main();
