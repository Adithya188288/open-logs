// All projects (/projects): one card per project, with rename and delete.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { confirmDelete, FormDialog, openDialog, toast } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { newProjectDialog, projectHome, Topbar, useApp } from '../components/Layout.jsx';
import { MenuButton } from '../components/Menu.jsx';
import { ApiError, api } from '../lib/api.js';
import { activity } from '../lib/activity.js';
import { ago, compact, num } from '../lib/format.js';
import { q } from '../lib/queries.js';

const LOOK = {
  waiting: { cls: '', dot: 'dot idle' },
  live: { cls: 'ok', dot: 'dot live' },
  idle: { cls: '', dot: 'dot off' },
};

/** @param {{ last_event_at: number | null }} p */
function status(p) {
  const a = activity(p.last_event_at);
  return { label: a.label, ...LOOK[a.state] };
}

/** @param {{ values: number[] }} props */
function Sparkline({ values }) {
  const max = Math.max(...values);
  const pts = max
    ? values
        .map((v, i) => `${Math.round((i * 240) / (values.length - 1))},${37 - Math.round((v / max) * 32)}`)
        .join(' ')
    : '0,36 240,36';
  return (
    <svg viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline className={max ? undefined : 'empty'} points={pts} />
    </svg>
  );
}

export function Projects() {
  const { me, projects, reloadProjects } = useApp();
  // Visiting this page refreshes the 24h stats if they're more than 5 minutes old.
  useQuery(q.projects());
  const [find, setFind] = useState('');
  const navigate = useNavigate();
  const live = projects.filter((p) => status(p).cls === 'ok').length;
  const shown = projects.filter((p) => p.name.toLowerCase().includes(find.trim().toLowerCase()));

  /** @param {import('../components/Layout.jsx').Project} p */
  const rename = (p) =>
    openDialog((close) => (
      <FormDialog
        title="Rename project"
        submitLabel="Rename"
        onClose={close}
        onSubmit={async (v) => {
          try {
            await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: v.name } });
            await reloadProjects();
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Rename failed';
          }
        }}
      >
        <div className="field">
          <label className="label" htmlFor="rname">
            Project name
          </label>
          <input
            id="rname"
            className="input mono"
            name="name"
            required
            maxLength={64}
            defaultValue={p.name}
          />
        </div>
      </FormDialog>
    ));

  /** @param {import('../components/Layout.jsx').Project} p */
  const remove = (p) =>
    confirmDelete({
      title: `Delete project ${p.name}?`,
      body: 'This deletes its sources (their tokens stop working), dashboards and saved views. Logs already in Basin stay in R2.',
      confirmLabel: 'Delete project',
      onConfirm: async () => {
        try {
          await api(`/api/projects/${p.id}`, { method: 'DELETE' });
          await reloadProjects();
          toast('Project deleted');
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Delete failed';
        }
      },
    });

  return (
    <>
      <Topbar
        title="Projects"
        meta={
          <span className="small muted">{`${projects.length} project${projects.length === 1 ? '' : 's'} · ${live} live`}</span>
        }
      >
        <div className="searchbox">
          <Icon name="search" size={15} />
          <label className="sr" htmlFor="find">
            Find a project
          </label>
          <input
            id="find"
            type="search"
            placeholder="Find a project"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
        </div>
        <button
          className="btn primary"
          type="button"
          onClick={() => newProjectDialog(navigate, reloadProjects)}
        >
          <Icon name="plus" size={14} />
          New project
        </button>
      </Topbar>
      <div className="page">
        <div className="projects" data-testid="projects">
          {shown.map((p) => {
            const st = status(p);
            return (
              <article key={p.id} className="card project" data-testid="project-card">
                <div className="head">
                  <Link className="name" to={projectHome(p.id)}>
                    {p.name}
                  </Link>
                  <div className="headr">
                    <span className={`pill${st.cls ? ` ${st.cls}` : ''}`}>
                      <span className={st.dot} />
                      {st.label}
                    </span>
                    <MenuButton
                      className="iconbtn"
                      label={`Options for ${p.name}`}
                      items={() => (
                        <>
                          <Link role="menuitem" to={projectHome(p.id)}>
                            Open
                          </Link>
                          <button type="button" role="menuitem" onClick={() => rename(p)}>
                            Rename
                          </button>
                          {me.role !== 'member' && (
                            <button
                              className="danger"
                              type="button"
                              role="menuitem"
                              onClick={() => remove(p)}
                            >
                              Delete project
                            </button>
                          )}
                        </>
                      )}
                    >
                      <Icon name="more" />
                    </MenuButton>
                  </div>
                </div>
                <Sparkline values={p.stats.spark} />
                <div className="stats">
                  <span>
                    <b>{compact(p.stats.events_24h)}</b> events · 24h
                  </span>
                  <span>
                    <b className={p.stats.errors_24h > 0 ? 'bad' : undefined}>{num(p.stats.errors_24h)}</b>{' '}
                    errors
                  </span>
                </div>
                <div className="foot">
                  {p.sources.length ? (
                    <div className="tags">
                      {p.sources.map((s) => (
                        <span key={s.id} className="tag">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <Link className="btn" to={`/sources?project=${encodeURIComponent(p.id)}`}>
                      <Icon name="plug" size={14} />
                      Add a source
                    </Link>
                  )}
                  <span className="seen">
                    {p.last_event_at ? `Last event ${ago(p.last_event_at)}` : `Created ${ago(p.created_at)}`}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
