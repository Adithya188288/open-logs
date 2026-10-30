// Source detail (/source?project=…&id=…): stats, how to send, rename, regenerate token, delete.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { confirmDelete, FormDialog, Modal, openDialog } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useApp, useProject } from '../components/Layout.jsx';
import { Loader } from '../components/Loader.jsx';
import { SendPanel } from '../components/SendPanel.jsx';
import { ApiError, api } from '../lib/api.js';
import { ago, hms, num } from '../lib/format.js';

const DAY = 86_400_000;

/** @param {{ label: string, children: import('react').ReactNode }} props */
function Stat({ label, children }) {
  return (
    <div className="stat">
      <span className="tiny muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function Source() {
  const project = useProject();
  const { me, reloadProjects } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get('id') ?? '';
  const [source, setSource] = useState(/** @type {any} */ (null));
  const [count, setCount] = useState(/** @type {string | null} */ (null));
  const list = `/sources?project=${encodeURIComponent(project.id)}`;

  useEffect(() => {
    api(`/api/sources/${encodeURIComponent(id)}`)
      .then((r) => setSource(r.source))
      .catch(() => navigate(list, { replace: true }));
  }, [id, list, navigate]);

  const loadCount = useCallback(
    async (/** @type {string} */ name) => {
      const now = Date.now();
      try {
        const r = await api('/api/aggregate', {
          body: {
            project_id: project.id,
            from: now - DAY,
            to: now + 1000,
            where: [{ field: 'source', op: '=', value: name }],
            measure: 'count',
            parts: ['value'],
          },
        });
        setCount(num(r.value ?? 0));
      } catch {
        setCount('—');
      }
    },
    [project.id],
  );

  useEffect(() => {
    if (source?.name) loadCount(source.name);
  }, [source?.name, loadCount]);

  if (!source) return <PageLoader />;

  const rename = () =>
    openDialog((close) => (
      <FormDialog
        title="Rename source"
        submitLabel="Rename"
        onClose={close}
        onSubmit={async (v) => {
          try {
            setSource(
              (await api(`/api/sources/${source.id}`, { method: 'PATCH', body: { name: v.name } })).source,
            );
            reloadProjects();
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Rename failed';
          }
        }}
      >
        <div className="field">
          <label className="label" htmlFor="sname">
            Name
          </label>
          <input
            id="sname"
            className="input mono"
            name="name"
            required
            maxLength={64}
            defaultValue={source.name}
          />
        </div>
        <p className="small muted">New events get the new name. Events already stored keep the old one.</p>
      </FormDialog>
    ));

  const regenerate = () =>
    openDialog((close) => (
      <FormDialog
        title={`Regenerate token for ${source.name}?`}
        submitLabel="Regenerate token"
        onClose={close}
        onSubmit={async () => {
          const res = await api(`/api/sources/${source.id}/regenerate`, { method: 'POST' });
          setSource(res.source);
          setTimeout(() =>
            openDialog((done) => (
              <Modal title="New token" wide onClose={done}>
                <p className="small">Update your apps with this token:</p>
                <SendPanel sourceName={res.source.name} token={res.token} />
              </Modal>
            )),
          );
          return null;
        }}
      >
        <p className="small muted">
          The current token stops working immediately. Apps using it get 401 until you update them.
        </p>
      </FormDialog>
    ));

  const remove = () =>
    confirmDelete({
      title: `Delete source ${source.name}?`,
      body: 'Its token stops working right away, so apps sending with it get 401. Logs already stored stay.',
      confirmLabel: 'Delete source',
      onConfirm: async () => {
        try {
          await api(`/api/sources/${source.id}`, { method: 'DELETE' });
          await reloadProjects();
          navigate(list);
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Delete failed';
        }
      },
    });

  const rejected = source.rejected_count > 0;
  const recent = source.last_event_at && Date.now() - source.last_event_at < 5 * 60_000;
  const tail = `/tail?project=${encodeURIComponent(project.id)}&source=${encodeURIComponent(source.name)}`;

  return (
    <>
      <Topbar
        title={
          <div className="crumbs">
            <Link className="muted" to={list}>
              Sources
            </Link>
            <span className="muted"> / </span>
            <h1 className="mono">{source.name}</h1>
            <button
              className="iconbtn"
              type="button"
              aria-label="Rename source"
              title="Rename"
              onClick={rename}
            >
              <Icon name="edit" size={14} />
            </button>
          </div>
        }
      >
        <button className="btn" type="button" onClick={regenerate}>
          Regenerate token
        </button>
        {me.role !== 'member' && (
          <button className="btn danger" type="button" onClick={remove}>
            Delete
          </button>
        )}
      </Topbar>
      <div className="page">
        <div className="stats-row">
          <Stat label="Created">{`${new Date(source.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`}</Stat>
          <Stat label="Last event">
            {source.last_event_at
              ? `${ago(source.last_event_at)} (${hms(source.last_event_at)} UTC)`
              : 'never'}
          </Stat>
          <Stat label="Events · 24h">
            {count === null ? <Loader size="sm" inline /> : <span data-testid="events-24h">{count}</span>}
            {recent && <span className="tiny muted"> · new events take 1–3 minutes to appear</span>}
          </Stat>
          <Stat label="Rejected requests">
            {rejected ? (
              <span className="bad">{`${num(source.rejected_count)} · last ${hms(source.last_rejected_at)} UTC`}</span>
            ) : (
              '0'
            )}
          </Stat>
        </div>
        {rejected && source.last_rejected_at > (source.last_event_at ?? 0) && (
          <div className="alert err" role="alert">
            <Icon name="info" />
            <div className="body">
              <strong>Requests are being rejected</strong>
              <span>
                Apps are sending with an old token (401 invalid token). Update them with the current token, or
                regenerate it.
              </span>
            </div>
          </div>
        )}
        <section className="card panel">
          <div className="spread">
            <h2>How to send logs</h2>
            <Link className="btn" to={tail}>
              Open live tail →
            </Link>
          </div>
          <SendPanel sourceName={source.name} tokenPrefix={source.token_prefix} />
        </section>
      </div>
    </>
  );
}
