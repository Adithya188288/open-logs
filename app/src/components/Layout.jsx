// The signed-in frame: sidebar (project switcher under the logo) stays mounted while screens change.
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../lib/api.js';
import { initials } from '../lib/format.js';
import { isProjectLoaded, loadProject, q, queryClient, refresh } from '../lib/queries.js';
import { currentTheme, toggleTheme } from '../lib/theme.js';
import { FormDialog, openDialog, Overlays } from './Dialogs.jsx';
import { Icon, ThemeIcon } from './Icon.jsx';
import { Loader } from './Loader.jsx';
import { MenuButton } from './Menu.jsx';

const PROJECT_KEY = 'ol-project';
const PROJECT_PAGES = new Set(['/dashboard', '/tail', '/alerts', '/alert', '/sources', '/source']);

/**
 * @typedef {{ id: string, email: string, name: string, role: 'owner' | 'admin' | 'member' }} Me
 * @typedef {{ id: string, name: string, created_at: number, sources: { id: string, name: string }[] }} Project
 * @typedef {{ me: Me, team: string, setTeam: (t: string) => void, projects: Project[], project: Project | undefined, reloadProjects: () => Promise<unknown> }} AppState
 */

const AppContext = createContext(/** @type {AppState | null} */ (null));

/** @returns {AppState} */
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside Layout');
  return ctx;
}

/** The current project; screens that need one render a loader until it exists. */
export function useProject() {
  const { project } = useApp();
  if (!project) throw new Error('no project');
  return project;
}

function remembered() {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

/** @param {string} id */
function remember(id) {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {}
}

/** @param {string} id */
export function projectHome(id) {
  return `/dashboard?project=${encodeURIComponent(id)}`;
}

/**
 * @param {(path: string) => void} go
 * @param {() => Promise<void>} reload  refreshes the project list so the new project is known
 */
export function newProjectDialog(go, reload) {
  openDialog((close) => (
    <FormDialog
      title="New project"
      submitLabel="Create project"
      onClose={close}
      onSubmit={async (v) => {
        try {
          const { project } = await api('/api/projects', { body: { name: v.name } });
          remember(project.id);
          await reload();
          go(`/sources?project=${encodeURIComponent(project.id)}`);
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Could not create the project';
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor="pname">
          Project name
        </label>
        <input
          id="pname"
          className="input mono"
          name="name"
          required
          maxLength={64}
          placeholder="payments"
          autoComplete="off"
        />
      </div>
      <p className="small muted">A project groups the sources (services) of one team or product.</p>
    </FormDialog>
  ));
}

export function Layout() {
  const meQuery = useQuery(q.me());
  const projectsQuery = useQuery(q.projects());
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const projects = projectsQuery.data;

  const reloadProjects = useCallback(() => refresh.projects(), []);
  const setTeam = useCallback((/** @type {string} */ team_name) => {
    queryClient.setQueryData(['me'], (/** @type {any} */ m) => (m ? { ...m, team_name } : m));
  }, []);

  // Narrow windows: the sidebar is a drawer behind the top bar's menu button, closed on every screen change.
  const [menuOpen, setMenuOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the screen or project changing is the trigger
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!menuOpen) return;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Each screen opens at its top, not at the previous screen's scroll position.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the screen changing is the trigger
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const asked = params.get('project');
  const project = useMemo(() => {
    if (!projects) return undefined;
    if (asked) return projects.find((p) => p.id === asked);
    return projects.find((p) => p.id === remembered()) ?? projects[0];
  }, [projects, asked]);

  useEffect(() => {
    if (project) remember(project.id);
    if (projects && asked && !project) navigate('/projects', { replace: true });
  }, [project, projects, asked, navigate]);

  // One load per project (and at start-up): everything its screens show, so moving between them never waits.
  const projectId = project?.id;
  const hasSources = Boolean(project?.sources.length);
  const [loadedFor, setLoadedFor] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!projectId) return;
    let current = true;
    loadProject(projectId, hasSources).then(() => current && setLoadedFor(projectId));
    return () => {
      current = false;
    };
  }, [projectId, hasSources]);
  const projectReady = !projectId || loadedFor === projectId || isProjectLoaded(projectId);

  const me = meQuery.data;
  const state = useMemo(
    () =>
      me && projects ? { me: me.user, team: me.team_name, setTeam, projects, project, reloadProjects } : null,
    [me, projects, project, setTeam, reloadProjects],
  );

  if (!state || !projectReady) {
    return (
      <div className="boot">
        <Loader size="lg" label="Loading" />
      </div>
    );
  }

  return (
    <AppContext.Provider value={state}>
      <div className="app">
        <header className="mobilebar">
          <button
            className="iconbtn"
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <span className="team">{state.team}</span>
          {project && <span className="project small muted">{project.name}</span>}
        </header>
        {menuOpen && <div className="scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="main">
          <Outlet key={`${location.pathname}?${project?.id ?? ''}`} />
        </main>
      </div>
      <Overlays />
    </AppContext.Provider>
  );
}

/** @param {{ open: boolean, onClose: () => void }} props  open: shown as a drawer (narrow windows only) */
function Sidebar({ open, onClose }) {
  const { me, team, projects, project, reloadProjects } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [themeLabel, setThemeLabel] = useState(currentTheme() === 'dark' ? 'Light mode' : 'Dark mode');
  const page =
    PROJECT_PAGES.has(location.pathname) && location.pathname !== '/source'
      ? location.pathname === '/alert'
        ? '/alerts'
        : location.pathname
      : '/dashboard';
  const q = project ? `?project=${encodeURIComponent(project.id)}` : '';
  const isOn = (/** @type {string} */ path) =>
    location.pathname === path ||
    (path === '/sources' && location.pathname === '/source') ||
    (path === '/alerts' && location.pathname === '/alert');

  /** @param {string} to @param {Parameters<typeof Icon>[0]['name']} icon @param {string} label @param {unknown} [count] */
  const item = (to, icon, label, count) => (
    <Link className="item" to={to} aria-current={isOn(to.split('?')[0]) ? 'page' : undefined}>
      <Icon name={icon} />
      {label}
      {count !== undefined && <span className="count">{String(count)}</span>}
    </Link>
  );

  return (
    <nav className={`nav${open ? ' open' : ''}`} aria-label="Main">
      <div className="brandrow">
        <Link className="brand" to="/">
          <span className="logo" />
          <span>{team}</span>
        </Link>
        <button className="iconbtn close" type="button" aria-label="Close menu" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <MenuButton
        className="switcher"
        title="Switch project"
        testId="project-switcher"
        items={() => (
          <>
            <div className="menu-label">Projects</div>
            {projects.map((x) => (
              <Link
                key={x.id}
                role="menuitem"
                to={`${page}?project=${encodeURIComponent(x.id)}`}
                aria-current={x.id === project?.id ? 'true' : undefined}
              >
                {x.name}
              </Link>
            ))}
            <hr />
            <button type="button" role="menuitem" onClick={() => newProjectDialog(navigate, reloadProjects)}>
              <Icon name="plus" size={14} />
              New project
            </button>
            <Link role="menuitem" to="/projects">
              <Icon name="folders" size={14} />
              All projects
            </Link>
          </>
        )}
      >
        <span>{project ? project.name : 'Choose a project'}</span>
        <Icon name="chevron" size={14} />
      </MenuButton>
      {project && (
        <>
          {item(`/dashboard${q}`, 'chart', 'Dashboard')}
          {item(`/tail${q}`, 'tail', 'Live tail')}
          <AlertsItem projectId={project.id} to={`/alerts${q}`} on={isOn('/alerts')} />
          {item(`/sources${q}`, 'plug', 'Sources', project.sources.length)}
        </>
      )}
      <div className="grow" />
      {item('/team', 'team', 'Team')}
      {item('/settings', 'settings', 'Settings')}
      <button
        className="item"
        type="button"
        data-testid="theme-toggle"
        onClick={() => setThemeLabel(toggleTheme() === 'dark' ? 'Light mode' : 'Dark mode')}
      >
        <span className="sr">Toggle theme: </span>
        <ThemeIcon />
        <span>{themeLabel}</span>
      </button>
      <div className="me">
        <span className="avatar" aria-hidden="true">
          {initials(me.name)}
        </span>
        <span className="name" title={me.email}>
          {me.name}
        </span>
        <button
          className="btn link tiny"
          type="button"
          data-testid="sign-out"
          onClick={async () => {
            await api('/api/auth/logout', { method: 'POST', redirectOn401: false }).catch(() => {});
            window.location.href = '/login';
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

/**
 * Sidebar link to Alerts, with the number of open incidents (checked every minute) when there are any.
 * @param {{ projectId: string, to: string, on: boolean }} props
 */
function AlertsItem({ projectId, to, on }) {
  const { data: open = 0 } = useQuery(q.openIncidents(projectId));
  return (
    <Link className="item" to={to} aria-current={on ? 'page' : undefined}>
      <Icon name="bell" />
      Alerts
      {open > 0 && (
        <span className="count open" title={`${open} open incident${open === 1 ? '' : 's'}`}>
          {open}
        </span>
      )}
    </Link>
  );
}

/**
 * Standard page header.
 * @param {{ title: import('react').ReactNode, meta?: import('react').ReactNode, children?: import('react').ReactNode }} props
 */
export function Topbar({ title, meta, children }) {
  return (
    <header className="topbar">
      <div className="title">
        {typeof title === 'string' ? <h1>{title}</h1> : title}
        {meta}
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}

/** Full-area loader for a screen's first load. @param {{ label?: string }} props */
export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="page-loader">
      <Loader label={label} />
    </div>
  );
}
