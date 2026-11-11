// All projects (/projects): a table of name, number of sources and created date, 12 per page. The list is the
// one the sidebar already loaded, so finding, sorting and paging all happen in the browser.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { confirmDelete, FormDialog, openDialog, toast } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { newProjectDialog, projectHome, Topbar, useApp } from '../components/Layout.jsx';
import { MenuButton } from '../components/Menu.jsx';
import { Pager } from '../components/Pager.jsx';
import { ApiError, api } from '../lib/api.js';
import { ago, hm } from '../lib/format.js';

/** @typedef {{ id: string, name: string, created_at: number, source_count: number }} ProjectRow */

const PAGE_SIZE = 12;

export function Projects() {
  const { me, projects, reloadProjects } = useApp();
  const [params, setParams] = useSearchParams();
  const [find, setFind] = useState('');
  const navigate = useNavigate();
  // Newest first, narrowed by name (any case), all in the browser.
  const matching = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return projects
      .filter((p) => p.name.toLowerCase().includes(needle))
      .map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, source_count: p.sources.length }))
      .sort((a, b) => b.created_at - a.created_at);
  }, [projects, find]);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
  const rows = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  /** @param {number} n */
  const goTo = (n) => setParams(n > 1 ? { page: String(n) } : {}, { replace: true });

  /** @param {ProjectRow} p */
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

  /** @param {ProjectRow} p */
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
          <span className="small muted">{`${projects.length} project${projects.length === 1 ? '' : 's'}`}</span>
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
            onChange={(e) => {
              setFind(e.target.value);
              goTo(1);
            }}
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
        <section className="card" aria-label="Projects">
          <table className="grid clickable" data-testid="projects">
            <thead>
              <tr>
                {['Name', 'Sources', 'Created', ''].map((t) => (
                  <th key={t} scope="col">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  data-testid="project-row"
                  onClick={(e) => {
                    // The options menu and its dialogs sit inside the row: only plain row clicks open it.
                    if (!(e.target instanceof Element) || !e.target.closest('button, [role="menu"], a'))
                      navigate(projectHome(p.id));
                  }}
                >
                  <td>
                    <Link className="mono" to={projectHome(p.id)} title={p.name}>
                      {p.name}
                    </Link>
                  </td>
                  <td className="mono">{p.source_count}</td>
                  <td>
                    <span className="small muted" title={`${hm(p.created_at, true)} UTC`}>
                      {ago(p.created_at)}
                    </span>
                  </td>
                  <td className="right">
                    <MenuButton
                      className="iconbtn"
                      label={`Options for ${p.name}`}
                      items={() => (
                        <>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="small muted empty-row">No projects match.</p>}
          <Pager page={page} pageSize={PAGE_SIZE} total={matching.length} onPage={goTo} />
        </section>
      </div>
    </>
  );
}
