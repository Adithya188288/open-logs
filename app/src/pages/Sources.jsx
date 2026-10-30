// Sources (/sources): the project's sources, and a modal to create one.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Modal, openDialog } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useProject } from '../components/Layout.jsx';
import { SendPanel } from '../components/SendPanel.jsx';
import { ApiError, api } from '../lib/api.js';
import { activity } from '../lib/activity.js';
import { ago, lagLabel } from '../lib/format.js';
import { q, refresh } from '../lib/queries.js';

const POLL_MS = 3000;

/** @param {{ s: any }} props */
function StatusPill({ s }) {
  const rejecting = s.rejected_count > 0 && (!s.last_event_at || s.last_rejected_at > s.last_event_at);
  if (rejecting)
    return (
      <span className="pill err" title={`${s.rejected_count} requests rejected with 401`}>
        {s.rejected_count} rejected
      </span>
    );
  const a = activity(s.last_event_at);
  return <span className={`pill${a.state === 'live' ? ' ok' : ''}`}>{a.label}</span>;
}

/**
 * New source: name → the one-time token and snippet → listening for the first event.
 * @param {{ projectId: string, lagMs: number, onCreated: () => void, onClose: () => void }} props
 */
function NewSource({ projectId, lagMs, onCreated, onClose }) {
  const [created, setCreated] = useState(/** @type {{ source: any, token: string } | null} */ (null));
  const [error, setError] = useState('');
  // Listens for the first event: polls only while it hasn't arrived and the tab is visible.
  const { data: live } = useQuery({
    ...q.source(created?.source.id ?? ''),
    enabled: Boolean(created),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.last_event_at ? false : POLL_MS),
  });
  const got = Boolean(live?.last_event_at);
  useEffect(() => {
    if (got) onCreated();
  }, [got, onCreated]);

  if (!created)
    return (
      <Modal title="New source" wide onClose={onClose}>
        <form
          className="field"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const res = await api(`/api/projects/${projectId}/sources`, {
                body: { name: new FormData(e.currentTarget).get('name') },
              });
              setCreated({ source: res.source, token: res.token });
              onCreated();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not create the source');
            }
          }}
        >
          <label className="label" htmlFor="svc">
            Name
          </label>
          <span className="small muted">One source per service. Its events are tagged with this name.</span>
          <div className="rowline">
            <input
              id="svc"
              className="input mono"
              name="name"
              required
              maxLength={64}
              placeholder="api"
              autoComplete="off"
              autoFocus
            />
            <button className="btn primary" type="submit">
              Create source
            </button>
          </div>
          <p className="error-text" role="alert">
            {error}
          </p>
        </form>
      </Modal>
    );

  const { source, token } = created;
  const tail = `/tail?project=${encodeURIComponent(projectId)}&source=${encodeURIComponent(source.name)}`;
  return (
    <Modal title="New source" wide onClose={onClose}>
      <p className="small">
        Source <b className="mono">{source.name}</b> created. Send it one event:
      </p>
      <SendPanel sourceName={source.name} token={token} />
      <div className={`verify ${got ? 'got' : 'listening'}`} role="status" data-testid="verify">
        <span className="beacon" aria-hidden="true">
          <span className="ring" />
          <span />
        </span>
        <div className="text">
          <span>
            {got ? 'First event received from ' : 'Listening for the first event from '}
            <span className="mono">{source.name}</span>
            {got ? '' : '…'}
          </span>
          <span>
            {got
              ? 'You’re connected.'
              : `${lagMs > 0 ? `Events land ${lagLabel(lagMs).replace('~', 'about ')} after they’re sent.` : 'Events show up within seconds.'} This updates on its own.`}
          </span>
        </div>
        <Link className="btn" to={tail} onClick={onClose}>
          Open live tail →
        </Link>
      </div>
      <div className="row">
        <Link
          className="btn"
          to={`/source?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(source.id)}`}
          onClick={onClose}
        >
          Source details
        </Link>
        <button className="btn primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function Sources() {
  const project = useProject();
  const { data: sources } = useQuery(q.sources(project.id));
  const lagMs = useQuery(q.status()).data?.lag_ms ?? 0;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectId = project.id;
  const changed = useCallback(() => refresh.sources(projectId), [projectId]);

  const newSource = useCallback(
    () =>
      openDialog((close) => (
        <NewSource projectId={project.id} lagMs={lagMs} onCreated={changed} onClose={close} />
      )),
    [project.id, lagMs, changed],
  );

  // ?new=1 (from "Connect a source" links) opens the New source modal once the list has loaded.
  const wantsNew = params.get('new') === '1';
  const openedNew = useRef(false);
  useEffect(() => {
    if (wantsNew && sources && !openedNew.current) {
      openedNew.current = true;
      newSource();
    }
  }, [wantsNew, sources, newSource]);

  const detail = (/** @type {any} */ s) =>
    `/source?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(s.id)}`;

  return (
    <>
      <Topbar title="Sources" meta={<span className="small muted">{project.name}</span>}>
        <button className="btn primary" type="button" onClick={newSource}>
          <Icon name="plus" size={14} />
          New source
        </button>
      </Topbar>
      <div className="page">
        {!sources ? (
          <PageLoader />
        ) : !sources.length ? (
          <div className="empty" data-testid="no-sources">
            <h2>Add your first source</h2>
            <p className="small">
              A source is one service or app that sends logs, like api, worker or web. Each gets its own
              token.
            </p>
            <button className="btn primary" type="button" onClick={newSource}>
              <Icon name="plus" size={14} />
              New source
            </button>
          </div>
        ) : (
          <section className="card sources" aria-label="Sources">
            <table className="grid clickable">
              <thead>
                <tr>
                  {['Name', 'Token', 'Last event', 'Status', ''].map((t) => (
                    <th key={t} scope="col">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} data-testid="source-row" onClick={() => navigate(detail(s))}>
                    <td>
                      <Link className="mono" to={detail(s)}>
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <code className="small muted">{s.token_prefix}…</code>
                    </td>
                    <td>
                      <span className="small muted">{s.last_event_at ? ago(s.last_event_at) : 'never'}</span>
                    </td>
                    <td>
                      <StatusPill s={s} />
                    </td>
                    <td className="right">
                      <Icon name="right" size={14} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
