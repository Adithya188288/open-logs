// Alerts (/alerts): every alert in the project (12 per page), filterable by status. Alerts are added from a chart.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useProject } from '../components/Layout.jsx';
import { Pager } from '../components/Pager.jsx';
import { alertStatus } from '../lib/alerts.js';
import { q } from '../lib/queries.js';

const STATUSES = [
  ['all', 'Any status'],
  ['open', 'Incident open'],
  ['ok', 'All good'],
  ['paused', 'Paused'],
];

/** @param {{ alert: any }} props */
export function AlertStatus({ alert }) {
  const s = alertStatus(alert);
  if (s === 'paused') return <span className="pill">Paused</span>;
  if (s === 'open') return <span className="pill err">Incident open</span>;
  return <span className="pill ok">All good</span>;
}

export function Alerts() {
  const project = useProject();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = STATUSES.some(([v]) => v === params.get('status')) ? String(params.get('status')) : 'all';
  const { data, isPlaceholderData } = useQuery({
    ...q.alertsPage(project.id, page, status),
    placeholderData: (prev) => prev,
  });
  /** @param {Record<string, string | number | null>} change */
  const go = (change) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(change)) {
      if (v === null || v === 1 || v === 'all') next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  const detail = (/** @type {any} */ a) =>
    `/alert?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(a.id)}`;
  const dashboards = `/dashboard?project=${encodeURIComponent(project.id)}`;

  return (
    <>
      <Topbar title="Alerts" meta={<span className="small muted">{project.name}</span>}>
        <select
          className="select"
          aria-label="Status"
          value={status}
          onChange={(e) => go({ status: e.target.value, page: null })}
        >
          {STATUSES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </Topbar>
      <div className="page">
        {!data ? (
          <PageLoader />
        ) : !data.total && status === 'all' ? (
          <div className="empty" data-testid="no-alerts">
            <h2>Add your first alert</h2>
            <p className="small">
              Alerts live on charts. On a dashboard, open a chart’s ⋯ menu and choose Add alert. You get a
              webhook when an incident opens and when it resolves.
            </p>
            <Link className="btn primary" to={dashboards}>
              Open dashboard
            </Link>
          </div>
        ) : (
          <>
            <p className="small muted">Add or edit alerts from a chart’s ⋯ menu on a dashboard.</p>
            <section className="card" aria-label="Alerts">
              <table className={`grid clickable${isPlaceholderData ? ' stale' : ''}`}>
                <thead>
                  <tr>
                    {['Name', 'Chart', 'Condition', 'Status', ''].map((t) => (
                      <th key={t} scope="col">
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.alerts.length ? (
                    data.alerts.map((/** @type {any} */ a) => (
                      <tr key={a.id} data-testid="alert-row" onClick={() => navigate(detail(a))}>
                        <td>
                          <Link to={detail(a)} title={a.name}>
                            {a.name}
                          </Link>
                        </td>
                        <td className="small">{a.chart_title}</td>
                        <td className="small">{a.condition}</td>
                        <td>
                          <AlertStatus alert={a} />
                        </td>
                        <td className="right">
                          <Icon name="right" size={14} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-row small muted">
                        No alerts match this status.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <Pager
                page={data.page}
                pageSize={data.page_size}
                total={data.total}
                busy={isPlaceholderData}
                onPage={(n) => go({ page: n })}
              />
            </section>
          </>
        )}
      </div>
    </>
  );
}
