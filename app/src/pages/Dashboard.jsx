// Dashboards: chart tiles, chart builder drawer, pin / edit / duplicate / remove, CSV export per chart.
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Chart, csvRows, formatValue, Legend } from '../components/Charts.jsx';
import { confirmDelete, FormDialog, openDialog, toast } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useProject } from '../components/Layout.jsx';
import { Loader } from '../components/Loader.jsx';
import { MenuButton } from '../components/Menu.jsx';
import { ApiError, api } from '../lib/api.js';
import { downloadCsv, toCsv } from '../lib/csv.js';
import { ago, hms, num } from '../lib/format.js';
import { q, queryClient, refresh } from '../lib/queries.js';
import { clauseToSearch, fieldFor, parseSearch } from '../lib/search.js';

const RANGES = { '15m': 15 * 60_000, '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };
const MEASURES = [
  ['count', 'Count'],
  ['count_over_time', 'Count over time'],
  ['avg', 'Average'],
  ['p95', 'p95'],
];
const VIZ = ['bar', 'pie', 'line', 'number'];

/** @typedef {import('../components/Charts.jsx').ChartDef & { id: string, size: string }} ChartRow */
/** @typedef {keyof typeof RANGES} Range */

/** @param {Range} range */
function windowFor(range) {
  const to = Date.now() + 1000;
  return { from: to - RANGES[range], to };
}

/**
 * Which parts of an aggregate a chart draws. Each part is a Basin query (min 10 MB billed),
 * so asking only for these keeps a dashboard load cheap.
 * @param {Pick<ChartRow, 'field' | 'measure' | 'viz'>} c
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
 * @param {string} projectId
 * @param {Pick<ChartRow, 'filter' | 'field' | 'measure' | 'viz'>} c
 * @param {{ from: number, to: number }} w
 * @param {string[]} [parts]
 */
function aggregate(projectId, c, w, parts = partsFor(c)) {
  return api('/api/aggregate', {
    body: {
      project_id: projectId,
      ...w,
      where: c.filter.where,
      measure: c.measure,
      field: c.field ?? undefined,
      parts,
    },
  });
}

export function Dashboard() {
  const project = useProject();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: dashboards } = useQuery(q.dashboards(project.id));
  const [range, setRange] = useState(/** @type {Range} */ ('1h'));
  const lag = useQuery(q.status()).data?.lag_ms ?? 0;
  const [drawer, setDrawer] = useState(
    /** @type {{ existing?: ChartRow, preset?: string } | null} */ (
      params.get('chart') ? { preset: params.get('chart') ?? undefined } : null
    ),
  );

  const dashboard = dashboards?.find((d) => d.id === params.get('id')) ?? dashboards?.[0];
  const here = (/** @type {any} */ d) =>
    `/dashboard?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(d.id)}`;
  const dashboardId = dashboard?.id;
  const { data: charts = [] } = useQuery({ ...q.charts(dashboardId ?? ''), enabled: Boolean(dashboardId) });
  /** @param {(cs: ChartRow[]) => ChartRow[]} fn */
  const setCharts = (fn) =>
    queryClient.setQueryData(['dashboard', dashboardId, 'charts'], (cs = []) => fn(cs));
  const reloadDashboards = useCallback(() => refresh.dashboards(project.id), [project.id]);

  // A project always has at least one dashboard; recreate Overview if the last one was deleted elsewhere.
  useEffect(() => {
    if (dashboards && !dashboards.length) {
      api(`/api/projects/${project.id}/dashboards`, { body: { name: 'Overview' } }).then(reloadDashboards);
    }
  }, [dashboards, project.id, reloadDashboards]);

  // Refresh when new data lands: one cheap check of the newest event time (every minute, or every
  // 5 minutes for long ranges; only while this tab is visible, and once when you come back to it).
  // Charts re-query only when that time actually changed.
  const hasSources = project.sources.length > 0;
  const { data: newest } = useQuery({
    ...q.newest(project.id, range === '24h' || range === '7d' ? 300_000 : 60_000),
    enabled: hasSources,
  });
  const lastNewest = useRef(newest);
  useEffect(() => {
    if (newest === undefined) return;
    if (lastNewest.current !== undefined && newest !== lastNewest.current) {
      queryClient.invalidateQueries({ queryKey: ['agg', project.id] });
    }
    lastNewest.current = newest;
  }, [newest, project.id]);
  const fetchingCharts = useIsFetching({ queryKey: ['agg', project.id] });
  const [updatedAt, setUpdatedAt] = useState(0);
  useEffect(() => {
    if (!fetchingCharts) setUpdatedAt(Date.now());
  }, [fetchingCharts]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  if (!dashboards || !dashboard) return <PageLoader label="Loading dashboard" />;
  const freshness = fetchingCharts ? 'Updating…' : updatedAt ? `Updated ${ago(updatedAt)}` : '';

  const w = windowFor(range);
  const newDashboard = () =>
    openDialog((close) => (
      <FormDialog
        title="New dashboard"
        submitLabel="Create dashboard"
        onClose={close}
        onSubmit={async (v) => {
          try {
            const { dashboard: d } = await api(`/api/projects/${project.id}/dashboards`, {
              body: { name: v.name },
            });
            await reloadDashboards();
            navigate(here(d));
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Could not create the dashboard';
          }
        }}
      >
        <div className="field">
          <label className="label" htmlFor="dname">
            Name
          </label>
          <input id="dname" className="input" name="name" required maxLength={60} placeholder="Payments" />
        </div>
      </FormDialog>
    ));
  const renameDashboard = () =>
    openDialog((close) => (
      <FormDialog
        title="Rename dashboard"
        submitLabel="Rename"
        onClose={close}
        onSubmit={async (v) => {
          try {
            await api(`/api/dashboards/${dashboard.id}`, { method: 'PATCH', body: { name: v.name } });
            await reloadDashboards();
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Rename failed';
          }
        }}
      >
        <div className="field">
          <label className="label" htmlFor="rname">
            Name
          </label>
          <input
            id="rname"
            className="input"
            name="name"
            required
            maxLength={60}
            defaultValue={dashboard.name}
          />
        </div>
      </FormDialog>
    ));
  const deleteDashboard = () =>
    confirmDelete({
      title: `Delete dashboard ${dashboard.name}?`,
      body: 'Its charts are deleted too. Logs are not affected.',
      confirmLabel: 'Delete dashboard',
      onConfirm: async () => {
        try {
          await api(`/api/dashboards/${dashboard.id}`, { method: 'DELETE' });
          await reloadDashboards();
          navigate(`/dashboard?project=${encodeURIComponent(project.id)}`);
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Delete failed';
        }
      },
    });

  const title = (
    <MenuButton
      className="titlebtn"
      testId="dashboard-switcher"
      items={() => (
        <>
          <div className="menu-label">Dashboards</div>
          {dashboards.map((d) => (
            <Link
              key={d.id}
              to={here(d)}
              role="menuitem"
              aria-current={d.id === dashboard.id ? 'true' : undefined}
              data-testid="dashboard-link"
            >
              {d.name}
            </Link>
          ))}
          <hr />
          <button type="button" role="menuitem" onClick={newDashboard}>
            <Icon name="plus" size={14} />
            New dashboard
          </button>
          <button type="button" role="menuitem" onClick={renameDashboard}>
            <Icon name="edit" size={14} />
            Rename this dashboard
          </button>
          {dashboards.length > 1 && (
            <button className="danger" type="button" role="menuitem" onClick={deleteDashboard}>
              <Icon name="x" size={14} />
              Delete this dashboard
            </button>
          )}
        </>
      )}
    >
      <h1>{dashboard.name}</h1>
      <Icon name="chevron" size={16} />
    </MenuButton>
  );

  const noSources = !project.sources.length;
  return (
    <>
      <Topbar
        title={title}
        meta={
          <span className="small muted">
            {noSources
              ? `${charts.length} charts, waiting for data`
              : `${charts.length} chart${charts.length === 1 ? '' : 's'} · data through ${hms(w.to - 1000 - lag)} UTC`}
          </span>
        }
      >
        {!noSources && (
          <span className="freshness small muted" data-testid="dashboard-freshness">
            {freshness}
            <button
              className="btn link small"
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['agg', project.id] })}
            >
              Refresh
            </button>
          </span>
        )}
        <div className="seg" role="group" aria-label="Time range">
          {Object.keys(RANGES).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setRange(/** @type {Range} */ (r))}
            >
              {r}
            </button>
          ))}
        </div>
        <button className="btn primary" type="button" onClick={() => setDrawer({})}>
          <Icon name="plus" size={14} />
          Add chart
        </button>
      </Topbar>
      <div className="tiles" data-testid="tiles">
        {noSources ? (
          // Nothing can have arrived yet, so don't spend Basin queries on empty charts.
          <div className="empty-board" data-testid="no-logs-yet">
            <h2>No logs yet</h2>
            <p className="small">
              Add a source (one per service), send it a log, and these charts fill in on their own.
            </p>
            <Link className="btn primary" to={`/sources?project=${encodeURIComponent(project.id)}&new=1`}>
              <Icon name="plus" size={14} />
              Add a source
            </Link>
          </div>
        ) : !charts.length ? (
          <div className="empty-board">
            <h2>No charts yet</h2>
            <p className="small">Build a chart from any filter and pin it here.</p>
            <button className="btn primary" type="button" onClick={() => setDrawer({})}>
              + Add chart
            </button>
          </div>
        ) : (
          charts.map((c) => (
            <Tile
              key={c.id}
              c={c}
              projectId={project.id}
              range={range}
              onEdit={() => setDrawer({ existing: c })}
              onDuplicate={async () => {
                const { chart } = await api(`/api/charts/${c.id}/duplicate`, { method: 'POST' });
                setCharts((cs) => [...cs, chart]);
                toast('Chart duplicated');
              }}
              onRemove={() =>
                confirmDelete({
                  title: `Remove chart “${c.title}”?`,
                  body: 'This removes the chart from the dashboard. Logs are not affected.',
                  confirmLabel: 'Remove chart',
                  onConfirm: async () => {
                    try {
                      await api(`/api/charts/${c.id}`, { method: 'DELETE' });
                      setCharts((cs) => cs.filter((x) => x.id !== c.id));
                      return null;
                    } catch (err) {
                      return err instanceof ApiError ? err.message : 'Remove failed';
                    }
                  },
                })
              }
            />
          ))
        )}
      </div>
      {drawer && (
        <ChartDrawer
          projectId={project.id}
          dashboard={dashboard}
          range={range}
          existing={drawer.existing}
          preset={drawer.preset}
          onClose={() => setDrawer(null)}
          onSaved={(chart) => {
            setCharts((cs) =>
              cs.some((x) => x.id === chart.id)
                ? cs.map((x) => (x.id === chart.id ? chart : x))
                : [...cs, chart],
            );
            setDrawer(null);
          }}
        />
      )}
    </>
  );
}

/**
 * @param {{ c: ChartRow, projectId: string, range: Range, onEdit: () => void, onDuplicate: () => void, onRemove: () => void }} props
 */
function Tile({ c, projectId, range, onEdit, onDuplicate, onRemove }) {
  // Keyed by what the chart shows, so an edited chart re-queries and an unchanged one stays cached.
  const spec = JSON.stringify([c.filter, c.field, c.measure, c.viz]);
  const { data: result, error } = useQuery({
    queryKey: ['agg', projectId, c.id, spec, range],
    queryFn: async () => {
      const w = windowFor(range);
      const span = w.to - w.from;
      const [data, prev] = await Promise.all([
        aggregate(projectId, c, w),
        c.viz === 'number' ? aggregate(projectId, c, { from: w.from - span, to: w.from }, ['value']) : null,
      ]);
      return { data, prev };
    },
  });
  const state = error
    ? { error: error instanceof ApiError ? error.message : 'Could not load this chart' }
    : { data: result?.data, prev: result?.prev };

  const linkFor = (/** @type {string} */ key) => {
    if (!c.field) return null;
    const q = [
      ...c.filter.where.map((w) => ('text' in w ? w.text : clauseToSearch(w))),
      clauseToSearch({ field: c.field, op: '=', value: key }),
    ].join(' ');
    return `/tail?project=${encodeURIComponent(projectId)}&range=${range}&q=${encodeURIComponent(q)}`;
  };

  return (
    <section className={`tile ${c.size}`} data-testid="chart" aria-label={c.title}>
      <div className="head">
        <h2>{c.title}</h2>
        <div className="headr">
          {state.data && <Legend c={c} data={state.data} />}
          <MenuButton
            className="more"
            label={`Chart options for ${c.title}`}
            items={() => (
              <>
                <button type="button" role="menuitem" onClick={onEdit}>
                  Edit
                </button>
                <button type="button" role="menuitem" onClick={onDuplicate}>
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (!state.data) return toast('Chart is still loading');
                    downloadCsv(
                      `${c.title.replace(/[^\w-]+/g, '-')}.csv`,
                      toCsv(['chart', 'key', 'value'], csvRows(c, state.data)),
                    );
                  }}
                >
                  Export CSV
                </button>
                <button type="button" role="menuitem" onClick={onRemove}>
                  Remove
                </button>
              </>
            )}
          >
            ⋯
          </MenuButton>
        </div>
      </div>
      <div className="body">
        {state.error ? (
          <p className="err" role="alert">
            {state.error}
          </p>
        ) : state.data ? (
          <Chart c={c} data={state.data} prev={state.prev} linkFor={linkFor} />
        ) : (
          <div className="nodata">
            <Loader size="sm" inline label={`Loading ${c.title}`} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Field options for the builder: columns plus keys seen in recent events.
 * @param {string} projectId
 * @param {Range} range
 */
async function discoverFields(projectId, range) {
  const { events } = await api('/api/query', {
    body: { project_id: projectId, ...windowFor(range), limit: 200 },
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
 * @param {{ projectId: string, dashboard: any, range: Range, existing?: ChartRow, preset?: string, onClose: () => void, onSaved: (c: ChartRow) => void }} props
 */
function ChartDrawer({ projectId, dashboard, range, existing, preset, onClose, onSaved }) {
  const [fields, setFields] = useState(/** @type {{ name: string, numeric: boolean }[] | null} */ (null));
  const [title, setTitle] = useState(existing?.title ?? '');
  const [query, setQuery] = useState(
    existing ? existing.filter.where.map((w) => ('text' in w ? w.text : clauseToSearch(w))).join(' ') : '',
  );
  const [applied, setApplied] = useState(query);
  const [field, setField] = useState(existing?.field ?? preset ?? '');
  const [measure, setMeasure] = useState(existing?.measure ?? 'count');
  const [viz, setViz] = useState(existing?.viz ?? 'bar');
  const [preview, setPreview] = useState(
    /** @type {{ data?: any, error?: string, note?: string } | null} */ (null),
  );
  const [error, setError] = useState('');
  const seq = useRef(0);
  const titleRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  // Runs once when the drawer opens: later changes to the form must not reset it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only
  useEffect(() => {
    discoverFields(projectId, range).then((list) => {
      const p = preset ? (list.find((f) => f.name === preset) ?? { name: preset, numeric: false }) : null;
      if (field && !list.some((f) => f.name === field)) list.push({ name: field, numeric: false });
      setFields(list);
      if (p && !existing) {
        const short = p.name.replace(/^fields\./, '');
        setTitle(p.numeric ? `p95 ${short}` : `Events by ${short}`);
        setMeasure(p.numeric ? 'p95' : 'count');
        setViz(p.numeric ? 'line' : 'bar');
      }
    });
    titleRef.current?.focus();
  }, []);

  // What the preview depends on (the title is not part of it, so typing a title doesn't re-query).
  const spec = useMemo(() => {
    const { clauses, text } = parseSearch(applied);
    /** @type {any[]} */
    const where = [...clauses];
    if (text) where.push({ text });
    return { title: '', filter: { where }, field: field ? fieldFor(field) : null, measure, viz };
  }, [applied, field, measure, viz]);
  const draft = {
    ...spec,
    title: title.trim() || 'Untitled chart',
    size: viz === 'number' ? 'sm' : existing?.size && existing.size !== 'sm' ? existing.size : 'md',
  };

  useEffect(() => {
    if (!fields) return;
    const mine = ++seq.current;
    if ((spec.measure === 'avg' || spec.measure === 'p95') && !spec.field?.startsWith('fields.')) {
      setPreview({ note: `${spec.measure === 'avg' ? 'Average' : 'p95'} needs a numeric field` });
      return;
    }
    setPreview(null);
    aggregate(projectId, spec, windowFor(range), [...new Set([...partsFor(spec), 'value'])])
      .then((data) => mine === seq.current && setPreview({ data }))
      .catch(
        (err) =>
          mine === seq.current &&
          setPreview({ error: err instanceof ApiError ? err.message : 'Preview failed' }),
      );
  }, [fields, spec, projectId, range]);

  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    try {
      const { chart } = existing
        ? await api(`/api/charts/${existing.id}`, { method: 'PATCH', body: draft })
        : await api(`/api/dashboards/${dashboard.id}/charts`, { body: draft });
      onSaved(chart);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the chart');
    }
  };

  const counted = preview?.data
    ? draft.measure === 'count' || draft.measure === 'count_over_time'
      ? ` · ${num(preview.data.value ?? 0)} events`
      : ` · ${formatValue(draft, preview.data.value)}`
    : '';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed backdrop closes the drawer; Escape does too
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Edit chart' : 'New chart'}
      >
        <div className="dhead">
          <h2>{existing ? 'Edit chart' : 'New chart'}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dbody">
          <div className="field">
            <label className="label" htmlFor="nm">
              Title
            </label>
            <input
              id="nm"
              ref={titleRef}
              className="input"
              maxLength={100}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="qf">
              Filter
            </label>
            <input
              id="qf"
              className="input mono"
              placeholder="level:error source:worker"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => setApplied(query)}
              onKeyDown={(e) => e.key === 'Enter' && setApplied(query)}
            />
          </div>
          <div className="two">
            <div className="field">
              <label className="label" htmlFor="fd">
                Field
              </label>
              <select
                id="fd"
                className="select"
                value={field}
                onChange={(e) => {
                  const f = fields?.find((x) => x.name === e.target.value);
                  setField(e.target.value);
                  if (f?.numeric && measure.startsWith('count')) setMeasure('p95');
                  if (!title)
                    setTitle(e.target.value ? `Events by ${e.target.value.replace(/^fields\./, '')}` : '');
                }}
              >
                <option value="">(none)</option>
                {(fields ?? []).map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name.replace(/^fields\./, '')}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="ag">
                Measure
              </label>
              <select id="ag" className="select" value={measure} onChange={(e) => setMeasure(e.target.value)}>
                {MEASURES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <span className="label">Visualization</span>
            <div className="vizs" role="group" aria-label="Visualization">
              {VIZ.map((v) => (
                <button key={v} type="button" aria-pressed={viz === v} onClick={() => setViz(v)}>
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="preview" data-testid="preview">
            <span>{`Preview · last ${range}${counted}`}</span>
            {!preview ? (
              <Loader size="sm" inline label="Loading preview" />
            ) : preview.note ? (
              <div className="nodata">{preview.note}</div>
            ) : preview.error ? (
              <p className="err">{preview.error}</p>
            ) : (
              <Chart c={draft} data={preview.data} />
            )}
          </div>
          <p className="error-text" role="alert">
            {error}
          </p>
        </div>
        <div className="dfoot">
          <button className="btn primary" type="button" onClick={save}>
            {existing ? 'Save chart' : `Pin to ${dashboard.name}`}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
}
