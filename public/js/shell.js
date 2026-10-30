// App frame: sidebar with the project switcher under the logo, theme toggle, signed-in user.
import { api, ApiError } from './api.js';
import { formDialog, h, icon, popMenu, s } from './dom.js';
import { initials } from './format.js';

const PROJECT_KEY = 'ol-project';

/**
 * @typedef {{ id: string, email: string, name: string, role: 'owner' | 'admin' | 'member' }} Me
 * @typedef {{ id: string, name: string, sources?: any[] }} ProjectRef
 * @typedef {'dashboard' | 'tail' | 'sources' | 'projects' | 'team' | 'settings'} Section
 */

/** Loads the signed-in user, or sends the browser to /login. */
export async function boot() {
  /** @type {{ user: Me, team_name: string }} */
  const data = await api('/api/me');
  return data;
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** @param {HTMLElement} [label] */
export function toggleTheme(label) {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('logs-theme', next);
  } catch {}
  if (label) label.textContent = themeLabel();
  window.dispatchEvent(new Event('themechange'));
}

export function themeLabel() {
  return currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';
}

function themeIcon() {
  return s(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.75,
      'aria-hidden': 'true',
    },
    s('circle', { cx: 12, cy: 12, r: 8 }),
    s('path', { d: 'M12 4a8 8 0 0 1 0 16z', fill: 'currentColor' }),
  );
}

export function themeButton(className = 'item') {
  const label = h('span', null, themeLabel());
  return h(
    `button.${className}`,
    { type: 'button', 'data-testid': 'theme-toggle', onclick: () => toggleTheme(label) },
    h('span.sr', null, 'Toggle theme: '),
    themeIcon(),
    label,
  );
}

/** @param {string} id */
function rememberProject(id) {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {}
}

function rememberedProject() {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

/** @param {string} projectId */
export function projectHome(projectId) {
  return `/dashboard?project=${encodeURIComponent(projectId)}`;
}

/**
 * Resolves the current project: `?project=`, else the last one used, else the first.
 * Always returns the project list too (for the switcher).
 * @param {{ required?: boolean }} [opts]  required: send the browser home if the project is unknown
 */
export async function loadProjectContext(opts = { required: true }) {
  const asked = new URLSearchParams(location.search).get('project');
  /** @type {{ projects: (ProjectRef & Record<string, any>)[] }} */
  const { projects } = await api('/api/projects');
  const project =
    projects.find((p) => p.id === asked) ??
    (asked ? undefined : (projects.find((p) => p.id === rememberedProject()) ?? projects[0]));
  if (!project && opts.required) {
    location.href = '/projects';
    throw new Error('unknown project');
  }
  if (project) rememberProject(project.id);
  return { project, projects };
}

/** Dialog that creates a project and opens its dashboard. */
export async function newProjectDialog() {
  const input = h('input.input.mono#pname', {
    name: 'name',
    required: true,
    maxlength: 64,
    placeholder: 'payments',
    autocomplete: 'off',
  });
  await formDialog(
    'New project',
    [
      h('div.field', null, h('label.label', { for: 'pname' }, 'Project name'), input),
      h('p.small.muted', null, 'A project groups the sources (services) of one team or product.'),
    ],
    'Create project',
    async (v) => {
      try {
        const { project } = await api('/api/projects', { body: { name: v.name } });
        rememberProject(project.id);
        location.href = `/sources?project=${encodeURIComponent(project.id)}`;
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Could not create the project';
      }
    },
  );
}

/**
 * @param {string} href
 * @param {Parameters<typeof icon>[0]} ic
 * @param {string} label
 * @param {boolean} current
 * @param {unknown} [count]
 */
function navLink(href, ic, label, current, count) {
  return h(
    'a.item',
    { href, 'aria-current': current ? 'page' : null },
    icon(ic),
    label,
    count !== undefined ? h('span.count', null, String(count)) : null,
  );
}

async function signOut() {
  await api('/api/auth/logout', { method: 'POST', redirectOn401: false }).catch(() => {});
  location.href = '/login';
}

/** Project-scoped pages keep their type when switching projects; others go to the dashboard. */
const PROJECT_PAGES = new Set(['/dashboard', '/tail', '/sources']);

/**
 * Renders the frame and returns the <main> element to fill.
 * @param {{ me: Me, team: string, active: Section, project?: ProjectRef, projects: ProjectRef[] }} o
 */
export function shell(o) {
  const nav = h(
    'nav.nav',
    { 'aria-label': 'Main' },
    h('a.brand', { href: '/' }, h('span.logo'), h('span', null, o.team)),
  );
  const p = o.project;
  const switcher = h(
    'button.switcher',
    { type: 'button', 'aria-haspopup': 'menu', 'data-testid': 'project-switcher', title: 'Switch project' },
    h('span', null, p ? p.name : 'Choose a project'),
    icon('chevron', 14),
  );
  switcher.addEventListener('click', () => {
    const page = PROJECT_PAGES.has(location.pathname) ? location.pathname : '/dashboard';
    popMenu(switcher, [
      h('div.menu-label', null, 'Projects'),
      ...o.projects.map((x) =>
        h(
          'a.mono',
          {
            href: `${page}?project=${encodeURIComponent(x.id)}`,
            'aria-current': x.id === p?.id ? 'true' : null,
            role: 'menuitem',
          },
          x.name,
        ),
      ),
      h('hr'),
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: newProjectDialog },
        icon('plus', 14),
        'New project',
      ),
      h('a', { href: '/projects', role: 'menuitem' }, icon('folders', 14), 'All projects'),
    ]);
  });
  nav.append(switcher);
  if (p) {
    const q = `?project=${encodeURIComponent(p.id)}`;
    nav.append(
      navLink(`/dashboard${q}`, 'chart', 'Dashboard', o.active === 'dashboard'),
      navLink(`/tail${q}`, 'tail', 'Live tail', o.active === 'tail'),
      navLink(`/sources${q}`, 'plug', 'Sources', o.active === 'sources', p.sources?.length),
    );
  }
  nav.append(
    h('div.grow'),
    navLink('/team', 'team', 'Team', o.active === 'team'),
    navLink('/settings', 'settings', 'Settings', o.active === 'settings'),
    themeButton(),
    h(
      'div.me',
      null,
      h('span.avatar', { 'aria-hidden': 'true' }, initials(o.me.name)),
      h('span.name', { title: o.me.email }, o.me.name),
      h('button.btn.link.tiny', { type: 'button', onclick: signOut, 'data-testid': 'sign-out' }, 'Sign out'),
    ),
  );
  const main = h('main.main');
  document.body.replaceChildren(h('div.app', null, nav, main));
  return { main, nav };
}

/**
 * Standard page header bar.
 * @param {string | Node} title
 * @param {(Node | string | null)[]} meta
 * @param {(Node | null)[]} actions
 */
export function topbar(title, meta, actions) {
  return h(
    'header.topbar',
    null,
    h('div.title', null, typeof title === 'string' ? h('h1', null, title) : title, ...meta),
    h('div.actions', null, ...actions),
  );
}

/** Boots a page: user, current project, sidebar. */
export async function page(/** @type {Section} */ active, opts = { required: true }) {
  const [{ user: me, team_name }, ctx] = await Promise.all([boot(), loadProjectContext(opts)]);
  const { main } = shell({ me, team: team_name, active, project: ctx.project, projects: ctx.projects });
  return { me, team: team_name, project: ctx.project, projects: ctx.projects, main };
}
