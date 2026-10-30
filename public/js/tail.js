// Live tail: search, histogram, event list with keyboard navigation, honest freshness.
import { api, ApiError } from './api.js';
import { downloadCsv, toCsv } from './csv.js';
import { copyText, formDialog, h, icon, mount, toast } from './dom.js';
import { ago, hm, hms, hmsms, num, span } from './format.js';
import { clauseLabel, clauseToSearch, parseSearch } from './search.js';
import { boot, loadProjectContext, shell, topbar } from './shell.js';

const RANGES = { '15m': 15 * 60_000, '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };
const LEGEND = /** @type {const} */ ([
  ['info', ['debug', 'info']],
  ['warn', ['warn']],
  ['error', ['error', 'fatal']],
]);
const PAGE = 100;

/** @typedef {import('./search.js').FieldClause} FieldClause */
/** @typedef {{ id: string, ts: number, source: string, level: string, message: string, fields: Record<string, unknown> }} LogEvent */

const state = {
  /** @type {keyof typeof RANGES | 'custom'} */
  range: '15m',
  custom: { from: 0, to: 0 },
  /** @type {FieldClause[]} */
  chips: [],
  text: '',
  /** @type {Set<string>} legend keys switched off */
  hidden: new Set(),
  /** @type {{ from: number, to: number } | null} */
  zoom: null,
  paused: false,
  wrap: false,
  relative: false,
  /** @type {LogEvent[]} */
  events: [],
  /** @type {LogEvent[]} newer events held back while reading */
  pending: [],
  /** @type {Set<string>} */
  freshIds: new Set(),
  nextCursor: /** @type {string | null} */ (null),
  cursor: 0,
  open: -1,
  total: 0,
  errors: 0,
  /** @type {any} */
  hist: null,
  /** @type {'loading' | 'ready' | 'too_large' | 'error'} */
  phase: 'loading',
  /** @type {ApiError | null} */
  problem: null,
  unfilteredTotal: 0,
  dataThrough: 0,
  nextCheckAt: 0,
  /** @type {string | null} event to open after load (from a link) */
  focusId: null,
};

let project = /** @type {any} */ (null);
let status = {
  storage: 'local',
  lag_ms: 0,
  now: Date.now(),
  newest_event_at: /** @type {number | null} */ (null),
};
/** @type {any[]} */
let sources = [];
let pollMs = 3000;
let loadSeq = 0;

const els = {
  status: h('span.pill'),
  ranges: h('div.seg', { role: 'group', 'aria-label': 'Time range' }),
  custom: h('div.custom-range', { hidden: true }),
  pause: h('button.btn', { type: 'button' }),
  chips: h('span', { class: 'chips' }),
  search: /** @type {HTMLInputElement} */ (
    h('input#q', {
      placeholder: 'Search message, or field:value  e.g. status:500',
      autocomplete: 'off',
      spellcheck: 'false',
    })
  ),
  wrap: h('button.btn', { type: 'button', 'aria-pressed': 'false' }, 'Wrap lines'),
  problem: h('div.problem', { hidden: true }),
  hist: h('div.hist'),
  thead: h('div.thead'),
  banner: h('button.banner', { type: 'button', hidden: true }),
  announce: h('div.sr', { 'aria-live': 'polite' }),
  list: h('div.list', {
    tabindex: '0',
    'aria-label': 'Event list. j and k move between events, Enter expands, slash jumps to search.',
  }),
  foot: h('div.tfoot'),
};

/** Current query window. */
function windowRange() {
  if (state.zoom) return state.zoom;
  if (state.range === 'custom') return state.custom;
  const to = Date.now() + 1000;
  return { from: to - RANGES[state.range], to };
}

function isLive() {
  return !state.paused && !state.zoom && state.range !== 'custom';
}

/** Clauses sent to the API: chips, free text, hidden levels. */
function where() {
  /** @type {object[]} */
  const w = [...state.chips];
  if (state.text) w.push({ text: state.text });
  const hiddenLevels = LEGEND.filter(([k]) => state.hidden.has(k)).flatMap(([, lv]) => lv);
  if (hiddenLevels.length) w.push({ field: 'level', op: 'not_in', value: hiddenLevels });
  return w;
}

/**
 * @param {string} path
 * @param {object} extra
 */
function post(path, extra) {
  return api(path, { body: { project_id: project.id, ...windowRange(), where: where(), ...extra } });
}

/** Full reload: histogram + first page. */
async function load() {
  const seq = ++loadSeq;
  state.phase = 'loading';
  state.problem = null;
  state.open = -1;
  state.cursor = 0;
  state.pending = [];
  render();
  try {
    const [page, hist, st] = await Promise.all([
      post('/api/query', { limit: PAGE }),
      post('/api/histogram', {}),
      api(`/api/status?project_id=${project.id}`),
    ]);
    if (seq !== loadSeq) return;
    status = st;
    state.events = page.events;
    state.nextCursor = page.next_cursor;
    state.hist = hist;
    state.total = hist.total;
    state.errors = hist.errors;
    state.dataThrough = st.now - st.lag_ms;
    state.phase = 'ready';
    if (!page.events.length && (state.chips.length || state.text || state.hidden.size)) {
      const all = await api('/api/histogram', { body: { project_id: project.id, ...windowRange() } });
      state.unfilteredTotal = all.total;
    }
    if (state.focusId) {
      const i = state.events.findIndex((e) => e.id === state.focusId);
      if (i >= 0) state.open = state.cursor = i;
      state.focusId = null;
    }
  } catch (err) {
    if (seq !== loadSeq) return;
    state.phase = err instanceof ApiError && err.code === 'query_too_large' ? 'too_large' : 'error';
    state.problem = err instanceof ApiError ? err : null;
  }
  state.nextCheckAt = Date.now() + pollMs;
  render();
}

/** Fetches events newer than the newest one shown and refreshes the histogram. */
async function poll() {
  if (!isLive() || state.phase !== 'ready') return;
  const seq = loadSeq;
  const newest = state.events[0]?.ts ?? windowRange().from;
  let histChanged = false;
  try {
    const [page, hist, st] = await Promise.all([
      api('/api/query', {
        body: { project_id: project.id, from: newest, to: Date.now() + 1000, where: where(), limit: 200 },
      }),
      post('/api/histogram', {}),
      api(`/api/status?project_id=${project.id}`),
    ]);
    if (seq !== loadSeq) return;
    status = st;
    state.dataThrough = st.now - st.lag_ms;
    histChanged = JSON.stringify(hist) !== JSON.stringify(state.hist);
    state.hist = hist;
    state.total = hist.total;
    state.errors = hist.errors;
    const known = new Set([...state.events, ...state.pending].map((e) => e.id));
    const fresh = page.events.filter((/** @type {LogEvent} */ e) => !known.has(e.id));
    if (fresh.length && isReading()) state.pending = [...fresh, ...state.pending];
    else if (fresh.length) {
      showNew(fresh);
      renderList();
    }
  } catch {}
  state.nextCheckAt = Date.now() + pollMs;
  // Only the parts that change; re-rendering the list would swallow clicks mid-press.
  renderStatus();
  if (histChanged) renderHistogram();
  renderBanner();
  renderFoot();
}

/** The user is looking at something: don't move rows under them. */
function isReading() {
  return state.open >= 0 || state.cursor > 0 || els.list.getBoundingClientRect().top < 0;
}

/** @param {LogEvent[]} fresh */
function showNew(fresh) {
  state.freshIds = new Set(fresh.map((e) => e.id));
  state.events = [...fresh, ...state.events];
  if (state.open >= 0) state.open += fresh.length;
  state.cursor = 0;
}

async function loadOlder() {
  if (!state.nextCursor) return;
  const page = await post('/api/query', { limit: PAGE, cursor: state.nextCursor });
  state.events = [...state.events, ...page.events];
  state.nextCursor = page.next_cursor;
  render();
}

// ---------- rendering ----------

function render() {
  renderStatus();
  renderRanges();
  renderChips();
  els.pause.textContent = state.paused ? '▶ Resume' : '❚❚ Pause';
  els.wrap.setAttribute('aria-pressed', String(state.wrap));
  els.list.classList.toggle('wrap', state.wrap);
  renderProblem();
  renderHistogram();
  renderHead();
  renderBanner();
  renderList();
  renderFoot();
}

function renderStatus() {
  const lag = status.lag_ms > 0 ? ` · ~${Math.round(status.lag_ms / 1000)}s ingest lag` : '';
  let text;
  let live = false;
  if (state.paused) text = `Paused · frozen at data through ${hms(state.dataThrough)} UTC`;
  else if (state.zoom || state.range === 'custom') {
    const w = windowRange();
    text = `Viewing ${hms(w.from)}–${hms(w.to)} UTC${lag}`;
  } else {
    const next = Math.max(0, Math.ceil((state.nextCheckAt - Date.now()) / 1000));
    text = `Data through ${hms(state.dataThrough)} UTC${lag} · next check ${next}s`;
    live = true;
  }
  els.status.className = `pill${live ? ' ok' : ''}`;
  els.status.dataset.testid = 'freshness';
  mount(els.status, h(`span.dot${live ? '.live' : '.off'}`), text);
}

function renderRanges() {
  mount(
    els.ranges,
    ...[...Object.keys(RANGES), 'custom'].map((r) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(state.range === r && !state.zoom),
          onclick: () => {
            state.zoom = null;
            if (r === 'custom') openCustom();
            else {
              state.range = /** @type {keyof typeof RANGES} */ (r);
              els.custom.hidden = true;
              load();
            }
          },
        },
        r === 'custom' ? 'Custom' : r,
      ),
    ),
  );
}

function openCustom() {
  const w = windowRange();
  const toLocal = (/** @type {number} */ ts) => new Date(ts).toISOString().slice(0, 16);
  const from = h('input', { type: 'datetime-local', value: toLocal(w.from), 'aria-label': 'From (UTC)' });
  const to = h('input', { type: 'datetime-local', value: toLocal(w.to), 'aria-label': 'To (UTC)' });
  const apply = h(
    'button.btn',
    {
      type: 'button',
      onclick: () => {
        const f = Date.parse(`${/** @type {HTMLInputElement} */ (from).value}Z`);
        const t = Date.parse(`${/** @type {HTMLInputElement} */ (to).value}Z`);
        if (!(f < t)) return toast('Pick a start before the end');
        if (t - f > RANGES['7d']) return toast('Custom ranges are limited to 7 days');
        state.range = 'custom';
        state.custom = { from: f, to: t };
        load();
      },
    },
    'Apply',
  );
  mount(els.custom, h('span.muted', null, 'UTC'), from, '→', to, apply);
  els.custom.hidden = false;
}

function renderChips() {
  mount(
    els.chips,
    ...state.chips.map((c, i) =>
      h(
        'span.chip',
        null,
        clauseLabel(c),
        h(
          'button',
          {
            type: 'button',
            'aria-label': `Remove filter ${clauseLabel(c)}`,
            onclick: () => (state.chips.splice(i, 1), load()),
          },
          '×',
        ),
      ),
    ),
  );
}

function renderProblem() {
  const now = Date.now();
  const bad = sources.find(
    (s) => s.rejected_count > 0 && s.last_rejected_at > (s.last_event_at ?? 0) && !dismissed(s),
  );
  els.problem.hidden = !bad;
  if (!bad) return mount(els.problem);
  const quiet = bad.last_event_at ? Math.round((now - bad.last_event_at) / 60_000) : null;
  mount(
    els.problem,
    h(
      'div.alert.err',
      { role: 'alert', 'data-testid': 'ingestion-problem' },
      icon('info'),
      h(
        'div.body',
        null,
        h(
          'strong',
          null,
          quiet !== null
            ? `No events from ${bad.name} for ${quiet} minute${quiet === 1 ? '' : 's'}`
            : `Requests from ${bad.name} are being rejected`,
        ),
        h(
          'span',
          null,
          `The last ${num(bad.rejected_count)} request${bad.rejected_count === 1 ? '' : 's'} from this source (latest ${hms(bad.last_rejected_at)} UTC) were rejected with `,
          h('code', null, '401 invalid token'),
          '. The token may have been regenerated.',
        ),
      ),
    ),
    h(
      'div.acts',
      null,
      h('a.btn', { href: `/connect?project=${encodeURIComponent(project.id)}` }, 'Check source token'),
      h('button.btn', { type: 'button', onclick: () => dismiss(bad) }, 'Dismiss'),
    ),
  );
}

/** @param {any} s */
function dismissKey(s) {
  return `ol-dismiss-${s.id}-${s.last_rejected_at}`;
}
/** @param {any} s */
function dismissed(s) {
  try {
    return localStorage.getItem(dismissKey(s)) === '1';
  } catch {
    return false;
  }
}
/** @param {any} s */
function dismiss(s) {
  try {
    localStorage.setItem(dismissKey(s), '1');
  } catch {}
  renderProblem();
}

function renderHistogram() {
  const hist = state.hist;
  if (!hist || state.phase !== 'ready') {
    mount(els.hist, h('div.summary', null, h('span', null, state.phase === 'loading' ? 'Loading…' : '')));
    return;
  }
  const w = windowRange();
  const max = Math.max(
    1,
    ...hist.buckets.map((/** @type {any} */ b) => b.debug + b.info + b.warn + b.error + b.fatal),
  );
  const bars = hist.buckets.map((/** @type {any} */ b) => {
    const total = b.debug + b.info + b.warn + b.error + b.fatal;
    const end = b.t + hist.interval_ms;
    const label = `${hms(b.t)} UTC · info ${b.info + b.debug}, warn ${b.warn}, error ${b.error + b.fatal} · click to zoom`;
    const bar = h('button.bar', {
      type: 'button',
      title: label,
      'aria-label': label,
      onclick: () => {
        state.zoom = { from: b.t, to: end };
        load();
      },
    });
    if (state.zoom && (b.t !== state.zoom.from || end !== state.zoom.to)) bar.classList.add('dim');
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug']) {
      const n = b[level];
      if (!n) continue;
      const seg = h(`span.seg-${level}`);
      seg.style.height = `${(n / max) * 64}px`;
      bar.append(seg);
    }
    if (!total) bar.classList.add('empty');
    return bar;
  });
  const ticks = 5;
  const xaxis = Array.from({ length: ticks }, (_, i) =>
    h('span', null, hm(w.from + ((w.to - w.from) * i) / (ticks - 1), w.to - w.from > 86_400_000)),
  );
  mount(
    els.hist,
    h(
      'div.summary',
      null,
      h(
        'span',
        null,
        h(
          'span',
          { 'data-testid': 'summary' },
          h('b', null, num(state.total)),
          ` events · ${state.zoom ? span(state.zoom.to - state.zoom.from) : state.range === 'custom' ? 'custom range' : span(RANGES[state.range])} · `,
          h('span.bad', null, `${num(state.errors)} errors`),
        ),
        state.zoom
          ? h(
              'span.zoomed',
              null,
              `${hms(state.zoom.from)}–${hms(state.zoom.to)} UTC`,
              h(
                'button.btn',
                { type: 'button', onclick: () => ((state.zoom = null), load()) },
                'Back to now',
              ),
            )
          : null,
      ),
      h(
        'span.legend',
        { role: 'group', 'aria-label': 'Show levels' },
        ...LEGEND.map(([key]) =>
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(!state.hidden.has(key)),
              onclick: () => {
                if (state.hidden.has(key)) state.hidden.delete(key);
                else state.hidden.add(key);
                load();
              },
            },
            h(`span.sw.${key}`),
            key,
          ),
        ),
      ),
    ),
    h(
      'div.plot',
      null,
      h('div.yaxis', { 'aria-hidden': 'true' }, h('span', null, String(max)), h('span', null, '0')),
      h('div.bars', { 'data-testid': 'histogram' }, ...bars),
    ),
    h('div.xaxis', { 'aria-hidden': 'true' }, ...xaxis),
  );
}

function renderHead() {
  mount(
    els.thead,
    h(
      'button',
      {
        type: 'button',
        title: 'Switch absolute / relative time',
        onclick: () => ((state.relative = !state.relative), render()),
      },
      state.relative ? 'Age ⇄' : 'Time · UTC ⇄',
    ),
    h('span', null, 'Level'),
    h('span', null, 'Source'),
    h('span', null, 'Message'),
    h('span'),
  );
}

function renderBanner() {
  const n = state.pending.length;
  els.banner.hidden = !n || state.paused;
  els.banner.textContent = `↑ ${n} new event${n === 1 ? '' : 's'} since you started reading · show`;
}

/**
 * Flattens nested fields to dot keys for the detail view.
 * @param {Record<string, unknown>} obj
 * @param {string} [prefix]
 * @returns {[string, unknown][]}
 */
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(/** @type {Record<string, unknown>} */ (v), `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );
}

/**
 * @param {string} field
 * @param {unknown} value
 */
function addFilter(field, value) {
  const v = typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
  state.chips = [...state.chips.filter((c) => c.field !== field), { field, op: '=', value: v }];
  load();
}

/** @param {LogEvent} e */
function detail(e) {
  /** @type {[string, unknown, string | null][]} */
  const rows = [
    ['timestamp', new Date(e.ts).toISOString(), null],
    ['source', e.source, 'source'],
    ['level', e.level, 'level'],
    ...flatten(e.fields).map(
      ([k, v]) => /** @type {[string, unknown, string | null]} */ ([k, v, `fields.${k}`]),
    ),
  ];
  const chartHref = (/** @type {string} */ f) =>
    `/dashboard?project=${encodeURIComponent(project.id)}&chart=${encodeURIComponent(f)}`;
  return h(
    'div.detail',
    null,
    h(
      'div.fields',
      null,
      ...rows.map(([k, v, field]) =>
        h(
          'div.f',
          null,
          h('span.k', { title: k }, k),
          h('span.v', null, typeof v === 'string' ? v : JSON.stringify(v)),
          h(
            'span.acts',
            null,
            field && (v === null || typeof v !== 'object')
              ? h(
                  'button.btn',
                  { type: 'button', title: 'Filter on this value', onclick: () => addFilter(field, v) },
                  '= Filter',
                )
              : null,
            field ? h('a.btn', { href: chartHref(field), title: 'Chart this field' }, 'Chart') : null,
          ),
        ),
      ),
    ),
    h(
      'div.side',
      null,
      h(
        'button.btn',
        {
          type: 'button',
          onclick: async () =>
            toast((await copyText(JSON.stringify(e, null, 2))) ? 'Copied as JSON' : 'Copy failed'),
        },
        'Copy as JSON',
      ),
      h(
        'button.btn',
        {
          type: 'button',
          onclick: () => {
            state.chips = [];
            state.text = '';
            els.search.value = '';
            state.hidden.clear();
            state.zoom = { from: e.ts - 30_000, to: e.ts + 30_000 };
            state.focusId = e.id;
            load();
          },
        },
        'Show surrounding events',
      ),
      h(
        'button.btn',
        {
          type: 'button',
          onclick: async () => {
            const url = `${location.origin}/tail?project=${encodeURIComponent(project.id)}&at=${e.ts}&event=${encodeURIComponent(e.id)}`;
            toast((await copyText(url)) ? 'Link copied' : 'Copy failed');
          },
        },
        'Copy link to event',
      ),
    ),
  );
}

function renderList() {
  if (state.phase === 'loading') {
    const widths = [72, 54, 88, 40, 66, 58, 80];
    mount(
      els.list,
      h(
        'div',
        { role: 'status', 'aria-label': 'Loading events' },
        ...widths.map((w) => {
          const msg = h('span');
          msg.style.width = `${w}%`;
          return h('div.sk', null, h('span'), h('span'), h('span'), msg);
        }),
        h(
          'div.sk-label',
          null,
          `Querying ${state.zoom ? 'the selected range' : `the last ${span(windowRange().to - windowRange().from)}`}…`,
        ),
      ),
    );
    return;
  }
  if (state.phase === 'too_large') {
    mount(
      els.list,
      h(
        'div.toolarge',
        { 'data-testid': 'too-large' },
        h(
          'div.alert.warn',
          { role: 'alert' },
          icon('warn'),
          h(
            'div.body',
            null,
            h('strong', null, 'This search would scan too much data'),
            h('span', null, state.problem?.hint ?? 'Narrow the time range or add a field filter.'),
          ),
        ),
        h(
          'div.acts',
          null,
          h(
            'button.btn',
            { type: 'button', onclick: () => ((state.range = '24h'), (state.zoom = null), load()) },
            'Try last 24h',
          ),
          h('button.btn', { type: 'button', onclick: () => addFilter('level', 'error') }, 'Add level:error'),
        ),
      ),
    );
    return;
  }
  if (state.phase === 'error') {
    mount(
      els.list,
      h(
        'div.state',
        { role: 'alert' },
        h('h2', null, 'Could not load events'),
        h('p', null, state.problem?.message ?? 'The server did not answer.'),
        h('button.btn', { type: 'button', onclick: load }, 'Retry'),
      ),
    );
    return;
  }
  if (!state.events.length) {
    mount(els.list, emptyState());
    return;
  }
  const now = Date.now();
  mount(
    els.list,
    ...state.events.map((e, i) => {
      const open = state.open === i;
      const wrap = h(
        `div.ev${open ? '.open' : ''}${state.cursor === i ? '.cursor' : ''}${state.freshIds.has(e.id) ? '.fresh' : ''}`,
        { 'data-testid': 'event', dataset: { id: e.id } },
      );
      wrap.append(
        h(
          'button.row',
          {
            type: 'button',
            tabindex: '-1',
            'aria-expanded': String(open),
            onclick: () => {
              state.cursor = i;
              state.open = open ? -1 : i;
              renderList();
            },
          },
          h('span.t', null, state.relative ? ago(e.ts, now) : hmsms(e.ts)),
          h(`span.lvl.${e.level}`, null, e.level.toUpperCase()),
          h('span.src', null, e.source),
          h('span.msg', null, e.message),
          h('span.chev', { 'aria-hidden': 'true' }, open ? '▾' : '▸'),
        ),
      );
      if (open) wrap.append(detail(e));
      return wrap;
    }),
  );
  state.freshIds.clear();
  const cur = state.events[state.cursor];
  els.announce.textContent = cur
    ? `Event ${state.cursor + 1} of ${state.events.length}: ${cur.level}, ${cur.source}, ${cur.message.slice(0, 120)}`
    : '';
}

function emptyState() {
  const filtered = state.chips.length || state.text || state.hidden.size;
  const w = windowRange();
  const window = state.zoom
    ? 'this range'
    : state.range === 'custom'
      ? 'this range'
      : `the last ${span(w.to - w.from)}`;
  if (filtered) {
    const label =
      [...state.chips.map(clauseToSearch), state.text].filter(Boolean).join(' ') || 'these levels';
    return h(
      'div.state',
      { 'data-testid': 'no-results' },
      icon('nothing', 28),
      h('h2', null, 'No events match ', h('code', null, label), ` in ${window}`),
      h('p', null, `${num(state.unfilteredTotal)} events came in during that time, none with this value.`),
      h(
        'div.rowline',
        null,
        state.range !== '24h' && !state.zoom
          ? h(
              'button.btn',
              { type: 'button', onclick: () => ((state.range = '24h'), load()) },
              'Search last 24h',
            )
          : null,
        h('button.btn', { type: 'button', onclick: clearFilters }, 'Clear filters'),
      ),
    );
  }
  if (!status.newest_event_at) {
    return h(
      'div.state',
      { 'data-testid': 'waiting' },
      h('h2', null, 'Waiting for the first event'),
      h('p', null, 'Connect a source and send one event. It shows up here on its own.'),
      h(
        'div.rowline',
        null,
        h(
          'a.btn.primary',
          { href: `/connect?project=${encodeURIComponent(project.id)}` },
          'Connect a source',
        ),
      ),
    );
  }
  return h(
    'div.state',
    { 'data-testid': 'no-results' },
    icon('nothing', 28),
    h('h2', null, `No events in ${window}`),
    h(
      'p',
      null,
      `The newest event arrived ${ago(status.newest_event_at)} (${hms(status.newest_event_at)} UTC).`,
    ),
    h(
      'div.rowline',
      null,
      h(
        'button.btn',
        { type: 'button', onclick: () => ((state.zoom = null), (state.range = '7d'), load()) },
        'Search last 7 days',
      ),
    ),
  );
}

function clearFilters() {
  state.chips = [];
  state.text = '';
  state.hidden.clear();
  els.search.value = '';
  load();
}

function renderFoot() {
  const more = state.nextCursor
    ? h('button.btn', { type: 'button', onclick: loadOlder }, 'Load older')
    : null;
  mount(
    els.foot,
    h(
      'span',
      null,
      state.phase === 'ready'
        ? `Showing ${num(state.events.length)} of ${num(state.total)} · newest first `
        : '',
      more,
    ),
    h(
      'span',
      null,
      h('kbd', null, 'j'),
      '/',
      h('kbd', null, 'k'),
      ' move · ',
      h('kbd', null, 'Enter'),
      ' expand · ',
      h('kbd', null, '/'),
      ' search',
    ),
  );
}

// ---------- input ----------

function applySearch() {
  const { clauses, text } = parseSearch(els.search.value);
  for (const c of clauses) state.chips = [...state.chips.filter((x) => x.field !== c.field), c];
  state.text = text;
  els.search.value = text;
  load();
}

/** @param {KeyboardEvent} e */
function onListKey(e) {
  const n = state.events.length;
  if (!n) return;
  if (e.key === 'j') {
    e.preventDefault();
    state.cursor = Math.min(n - 1, state.cursor + 1);
  } else if (e.key === 'k') {
    e.preventDefault();
    state.cursor = Math.max(0, state.cursor - 1);
  } else if (e.key === 'Enter') {
    if (e.target !== els.list) return;
    e.preventDefault();
    state.open = state.open === state.cursor ? -1 : state.cursor;
  } else return;
  renderList();
  els.list.querySelectorAll('.ev')[state.cursor]?.scrollIntoView({ block: 'nearest' });
}

async function saveView() {
  const input = h('input.input#vname', {
    name: 'name',
    required: true,
    maxlength: 60,
    placeholder: 'Errors only',
  });
  await formDialog(
    'Save view',
    [
      h('div.field', null, h('label.label', { for: 'vname' }, 'Name'), input),
      h('p.small.muted', null, 'Saves the search, filters and time range.'),
    ],
    'Save view',
    async (v) => {
      /** @type {object[]} */
      const w = [...state.chips];
      if (state.text) w.push({ text: state.text });
      try {
        await api(`/api/projects/${project.id}/views`, {
          body: { name: v.name, filter: { where: w, range: state.range === 'custom' ? '1h' : state.range } },
        });
        await renderViews();
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Could not save';
      }
    },
  );
}

const viewsNav = h('div');
async function renderViews() {
  const { views } = await api(`/api/projects/${project.id}/views`);
  mount(
    viewsNav,
    h('div.section', null, 'Saved views'),
    ...(views.length
      ? views.map((/** @type {any} */ v) =>
          h(
            'div.item',
            {
              role: 'button',
              tabindex: '0',
              'data-testid': 'saved-view',
              onclick: () => applyView(v),
              onkeydown: (/** @type {KeyboardEvent} */ e) => e.key === 'Enter' && applyView(v),
            },
            h('span.swatch'),
            h('span', null, v.name),
            h(
              'button.x',
              {
                type: 'button',
                'aria-label': `Delete view ${v.name}`,
                onclick: async (/** @type {Event} */ e) => {
                  e.stopPropagation();
                  await api(`/api/views/${v.id}`, { method: 'DELETE' });
                  renderViews();
                },
              },
              '×',
            ),
          ),
        )
      : [h('p.tiny.muted', { class: 'item' }, 'Save a search to find it here.')]),
  );
}

/** @param {any} v */
function applyView(v) {
  state.chips = v.filter.where.filter((/** @type {any} */ c) => 'field' in c);
  state.text = v.filter.where.find((/** @type {any} */ c) => 'text' in c)?.text ?? '';
  els.search.value = state.text;
  state.hidden.clear();
  state.zoom = null;
  if (v.filter.range) state.range = v.filter.range;
  load();
}

function exportCsv() {
  const csv = toCsv(
    ['time_utc', 'level', 'source', 'message', 'fields'],
    state.events.map((e) => [new Date(e.ts).toISOString(), e.level, e.source, e.message, e.fields]),
  );
  downloadCsv(`${project.name}-logs.csv`, csv);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const range = p.get('range');
  if (range && range in RANGES) state.range = /** @type {keyof typeof RANGES} */ (range);
  const q = p.get('q');
  if (q) {
    const { clauses, text } = parseSearch(q);
    state.chips = clauses;
    state.text = text;
    els.search.value = text;
  }
  const at = Number(p.get('at'));
  if (at) {
    state.zoom = { from: at - 30_000, to: at + 30_000 };
    state.focusId = p.get('event');
  }
}

async function main() {
  const [{ user: me, team_name }, ctx] = await Promise.all([boot(), loadProjectContext()]);
  project = ctx.project;
  sources = project.sources;
  status = await api(`/api/status?project_id=${project.id}`);
  pollMs = status.lag_ms > 0 ? 15_000 : 3000;

  const { main } = shell({
    me,
    team: team_name,
    active: 'tail',
    project,
    projects: ctx.projects,
    sourceCount: sources.length,
    extra: [viewsNav],
  });
  renderViews();

  els.pause.addEventListener('click', () => {
    state.paused = !state.paused;
    if (!state.paused) load();
    else render();
  });
  els.wrap.addEventListener('click', () => {
    state.wrap = !state.wrap;
    render();
  });
  els.banner.addEventListener('click', () => {
    showNew(state.pending);
    state.pending = [];
    render();
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applySearch();
    if (e.key === 'Escape') els.list.focus();
    if (e.key === 'Backspace' && !els.search.value && state.chips.length) {
      state.chips.pop();
      load();
    }
  });
  els.list.addEventListener('keydown', onListKey);
  document.addEventListener('keydown', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
      e.preventDefault();
      els.search.focus();
    }
  });

  main.append(
    topbar(
      'Live tail',
      [els.status],
      [els.ranges, els.pause, h('button.btn', { type: 'button', onclick: exportCsv }, 'Export CSV')],
    ),
    els.problem,
    h(
      'div.tail-tools',
      null,
      els.custom,
      h(
        'div.row',
        null,
        h(
          'div.query',
          null,
          icon('search', 15),
          els.chips,
          h('label.sr', { for: 'q' }, 'Search events'),
          els.search,
          h('kbd', null, '/'),
        ),
        els.wrap,
        h('button.btn', { type: 'button', onclick: saveView }, 'Save view'),
      ),
      els.hist,
    ),
    h('div.table', null, els.thead, els.banner, els.announce, els.list),
    els.foot,
  );

  readUrl();
  await load();
  setInterval(poll, pollMs);
  setInterval(() => isLive() && renderStatus(), 1000);
  setInterval(async () => {
    const res = await api(`/api/projects/${project.id}/sources`).catch(() => null);
    if (res) {
      sources = res.sources;
      renderProblem();
    }
  }, 30_000);
}

main();
