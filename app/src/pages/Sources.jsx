// Sources (/sources): the project's sources (name and created date, 12 per page), and a modal to create one.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Modal, openDialog } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useProject } from '../components/Layout.jsx';
import { Pager } from '../components/Pager.jsx';
import { SendPanel } from '../components/SendPanel.jsx';
import { ApiError, api } from '../lib/api.js';
import { ago, hm } from '../lib/format.js';
import { q, refresh } from '../lib/queries.js';

const POLL_MS = 3000;

/**
 * New source: name → the one-time token and snippet → waiting for the first event.
 * The source's first accepted log is recorded once in D1 (first_event_at), so this knows within seconds that
 * the app is connected, while the log itself shows up in live tail once Basin has it (about 1–2 minutes).
 * @param {{ projectId: string, onCreated: () => void, onClose: () => void }} props
 */
function NewSource({ projectId, onCreated, onClose }) {
  const [created, setCreated] = useState(/** @type {{ source: any, token: string } | null} */ (null));
  const [error, setError] = useState('');
  // Waits for the first event: polls only while this dialog is open, it hasn't arrived and the tab is visible.
  const { data: live } = useQuery({
    ...q.source(created?.source.id ?? ''),
    enabled: Boolean(created),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.first_event_at ? false : POLL_MS),
  });
  const got = Boolean(live?.first_event_at);
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
        Source <b className="mono">{source.name}</b> created. Send us a log event; it shows up in live tail in
        about 1–2 minutes.
      </p>
      <SendPanel sourceName={source.name} token={token} />
      <div className={`verify ${got ? 'got' : 'listening'}`} role="status" data-testid="verify">
        <span className="beacon" aria-hidden="true">
          <span className="ring" />
          <span />
        </span>
        <div className="text">
          <span>
            {got ? 'First event received from ' : 'Waiting for the first event from '}
            <span className="mono">{source.name}</span>
            {got ? '' : '…'}
          </span>
          <span>
            {got
              ? 'You’re connected. It shows up in live tail in about 1–2 minutes.'
              : 'This updates on its own once your app sends a log.'}
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
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  // Keep the previous page on screen while the next one loads.
  const { data, isPlaceholderData } = useQuery({
    ...q.sourcesPage(project.id, page),
    placeholderData: (prev) => prev,
  });
  const navigate = useNavigate();
  const projectId = project.id;
  const changed = useCallback(() => refresh.sources(projectId), [projectId]);
  /** @param {number} n */
  const goTo = (n) => {
    const next = new URLSearchParams(params);
    if (n > 1) next.set('page', String(n));
    else next.delete('page');
    setParams(next, { replace: true });
  };

  const newSource = useCallback(
    () => openDialog((close) => <NewSource projectId={project.id} onCreated={changed} onClose={close} />),
    [project.id, changed],
  );

  // ?new=1 (from "Connect a source" links) opens the New source modal once the list has loaded.
  const wantsNew = params.get('new') === '1';
  const openedNew = useRef(false);
  useEffect(() => {
    if (wantsNew && data && !openedNew.current) {
      openedNew.current = true;
      newSource();
    }
  }, [wantsNew, data, newSource]);

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
        {!data ? (
          <PageLoader />
        ) : !data.total ? (
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
            <table className={`grid clickable${isPlaceholderData ? ' stale' : ''}`}>
              <thead>
                <tr>
                  {['Name', 'Created', ''].map((t) => (
                    <th key={t} scope="col">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sources.map((/** @type {any} */ s) => (
                  <tr key={s.id} data-testid="source-row" onClick={() => navigate(detail(s))}>
                    <td>
                      <Link className="mono" to={detail(s)} title={s.name}>
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <span className="small muted" title={`${hm(s.created_at, true)} UTC`}>
                        {ago(s.created_at)}
                      </span>
                    </td>
                    <td className="right">
                      <Icon name="right" size={14} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager
              page={data.page}
              pageSize={data.page_size}
              total={data.total}
              busy={isPlaceholderData}
              onPage={goTo}
            />
          </section>
        )}
      </div>
    </>
  );
}
