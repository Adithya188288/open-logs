// One alert (/alert?project=…&id=…): its chart, what it checks, the open incident and the resolved ones.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertDrawer } from '../components/AlertDrawer.jsx';
import { Chart } from '../components/Charts.jsx';
import { confirmDelete, toast } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useProject } from '../components/Layout.jsx';
import { Loader } from '../components/Loader.jsx';
import { Pager } from '../components/Pager.jsx';
import { ApiError, api } from '../lib/api.js';
import { filterText, measureLabel, quietLabel, RESOLVED_BY } from '../lib/alerts.js';
import { ago, hm, num } from '../lib/format.js';
import { chartQuery } from '../lib/live.js';
import { q, refresh } from '../lib/queries.js';
import { AlertStatus } from './Alerts.jsx';

const HOUR = 3_600_000;

/** @param {number} n */
const value = (n) => num(Math.round(n * 100) / 100);

export function Alert() {
  const project = useProject();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get('id') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, isError, isPlaceholderData } = useQuery({
    ...q.alert(id, page),
    placeholderData: (prev) => prev,
  });
  const [editing, setEditing] = useState(false);
  const list = `/alerts?project=${encodeURIComponent(project.id)}`;
  useEffect(() => {
    if (isError) navigate(list, { replace: true });
  }, [isError, list, navigate]);

  if (!data) return <PageLoader />;
  const { alert, chart, open_incident: open, resolved } = data;
  const changed = () => refresh.alerts(project.id);

  /** @param {string} path */
  const act = async (path) => {
    try {
      await api(path, { method: 'POST' });
      await changed();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  };
  const remove = () =>
    confirmDelete({
      title: `Delete alert “${alert.name}”?`,
      body: 'Its incidents are deleted too. An open incident is resolved first and its webhook sent. The chart stays.',
      confirmLabel: 'Delete alert',
      onConfirm: async () => {
        try {
          await api(`/api/charts/${alert.chart_id}/alert`, { method: 'DELETE' });
          await changed();
          navigate(list);
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Delete failed';
        }
      },
    });

  /** Live tail for the chart's filter, over a range that covers the incident. @param {number} since */
  const logsFor = (since) => {
    const age = Date.now() - since;
    const range = age < HOUR ? '1h' : age < 24 * HOUR ? '24h' : '7d';
    return `/tail?project=${encodeURIComponent(project.id)}&range=${range}&q=${encodeURIComponent(filterText(chart.filter.where))}`;
  };
  const quietUntil = alert.quiet_until > Date.now() && !open ? alert.quiet_until : 0;

  return (
    <>
      <Topbar
        title={
          <div className="crumbs">
            <Link className="muted" to={list}>
              Alerts
            </Link>
            <span className="muted"> / </span>
            <h1>{alert.name}</h1>
          </div>
        }
        meta={<AlertStatus alert={alert} />}
      >
        <button className="btn" type="button" onClick={() => setEditing(true)}>
          <Icon name="edit" size={14} />
          Edit
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => act(`/api/alerts/${alert.id}/${alert.paused ? 'resume' : 'pause'}`)}
        >
          <Icon name={alert.paused ? 'play' : 'pause'} size={14} />
          {alert.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn danger" type="button" onClick={remove}>
          Delete
        </button>
      </Topbar>
      <div className="page">
        <div className="stats-row">
          <div className="stat">
            <span className="tiny muted">Opens an incident when</span>
            <span>{alert.condition}</span>
          </div>
          <div className="stat">
            <span className="tiny muted">Chart</span>
            <Link
              to={`/dashboard?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(chart.dashboard_id)}`}
            >
              {chart.title}
            </Link>
          </div>
          <div className="stat">
            <span className="tiny muted">Quiet time after resolving</span>
            <span>{quietLabel(alert.quiet_minutes)}</span>
          </div>
          <div className="stat">
            <span className="tiny muted">Webhook</span>
            <span className="mono small ellipsis" title={alert.webhook_url}>
              {alert.webhook_url}
            </span>
          </div>
        </div>
        <AlertChart projectId={project.id} chart={chart} />
        <section className="card panel" aria-label="Open incident">
          <h2>Open incident</h2>
          {open ? (
            <IncidentRow
              incident={open}
              logs={logsFor(open.started_at)}
              onResolve={() => act(`/api/incidents/${open.id}/resolve`)}
            />
          ) : (
            <p className="small muted" data-testid="no-open-incident">
              {alert.paused
                ? 'This alert is paused, so it isn’t checked.'
                : quietUntil
                  ? `None open. A new incident can open after ${hm(quietUntil, true)} UTC.`
                  : resolved.total
                    ? 'None open right now.'
                    : 'All good. Nothing has triggered yet.'}
            </p>
          )}
        </section>
        <section className={`card panel${isPlaceholderData ? ' stale' : ''}`} aria-label="Resolved incidents">
          <h2>{`Resolved incidents (${resolved.total})`}</h2>
          {resolved.incidents.length ? (
            resolved.incidents.map((/** @type {any} */ i) => (
              <IncidentRow key={i.id} incident={i} logs={logsFor(i.started_at)} />
            ))
          ) : (
            <p className="small muted">None yet.</p>
          )}
          <Pager
            page={resolved.page}
            pageSize={resolved.page_size}
            total={resolved.total}
            busy={isPlaceholderData}
            onPage={(n) => {
              const next = new URLSearchParams(params);
              if (n > 1) next.set('page', String(n));
              else next.delete('page');
              setParams(next, { replace: true });
            }}
          />
        </section>
      </div>
      {editing && (
        <AlertDrawer
          chart={{ ...chart, alert }}
          onClose={() => setEditing(false)}
          onSaved={async (saved) => {
            setEditing(false);
            await changed();
            if (!saved) navigate(list);
            else toast('Alert saved');
          }}
        />
      )}
    </>
  );
}

/** The alert's chart over the last hour, as on the dashboard. @param {{ projectId: string, chart: any }} props */
function AlertChart({ projectId, chart }) {
  const { data, error } = useQuery(chartQuery(projectId, chart, '1h'));
  return (
    <section className="card panel" aria-label={chart.title}>
      <h2>
        {chart.title} <span className="small muted">{`· ${measureLabel(chart)} · last hour`}</span>
      </h2>
      {error ? (
        <p className="error-text">{error instanceof ApiError ? error.message : 'Could not load the chart'}</p>
      ) : data ? (
        <div className={`alertchart ${chart.viz}`}>
          <Chart c={chart} data={data.data} prev={data.prev} />
        </div>
      ) : (
        <Loader size="sm" inline label={`Loading ${chart.title}`} />
      )}
    </section>
  );
}

/** @param {{ incident: any, logs: string, onResolve?: () => void }} props */
function IncidentRow({ incident: i, logs, onResolve }) {
  const open = !i.resolved_at;
  const hook = (/** @type {string | null} */ r) =>
    r ? `webhook ${/^\d+$/.test(r) ? `answered ${r}` : r}` : '';
  return (
    <div
      className={`incident${open ? ' open' : ''}`}
      data-testid={open ? 'open-incident' : 'resolved-incident'}
    >
      <Icon name={open ? 'warn' : 'check'} size={16} />
      <div className="what">
        <span>
          {`Started ${hm(i.started_at, true)} UTC · value ${value(i.value)}`}
          {i.previous !== null ? ` (was ${value(i.previous)})` : ''}
        </span>
        <span className="small muted">
          {open
            ? `Open for ${ago(i.started_at).replace(' ago', '')}${i.opened_webhook ? ` · ${hook(i.opened_webhook)}` : ''}`
            : `Resolved ${RESOLVED_BY[i.resolved_by] ?? ''} at ${hm(i.resolved_at, true)} UTC${
                i.resolved_webhook ? ` · ${hook(i.resolved_webhook)}` : ''
              }`}
        </span>
      </div>
      <Link className="btn" to={logs}>
        View logs
      </Link>
      {onResolve && (
        <button className="btn" type="button" onClick={onResolve}>
          Resolve
        </button>
      )}
    </div>
  );
}
