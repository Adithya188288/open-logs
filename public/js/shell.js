// App frame: sidebar (workspace or project mode), theme toggle, signed-in user.
import { api } from './api.js';
import { h, icon, popMenu, s } from './dom.js';
import { initials } from './format.js';

/**
 * @typedef {{ id: string, email: string, name: string, role: 'owner' | 'admin' | 'member' }} Me
 * @typedef {{ id: string, name: string }} ProjectRef
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

/**
 * @param {string} href
 * @param {Parameters<typeof icon>[0] | null} ic
 * @param {string} label
 * @param {boolean} current
 * @param {unknown} [count]
 */
function navLink(href, ic, label, current, count) {
  return h(
    'a.item',
    { href, 'aria-current': current ? 'page' : null },
    ic ? icon(ic) : null,
    label,
    count !== undefined ? h('span.count', null, String(count)) : null,
  );
}

async function signOut() {
  await api('/api/auth/logout', { method: 'POST', redirectOn401: false }).catch(() => {});
  location.href = '/login';
}

/**
 * Renders the frame and returns the <main> element to fill.
 * @param {{
 *   me: Me, team: string,
 *   active: 'projects' | 'tail' | 'dashboards' | 'sources',
 *   project?: ProjectRef, projects?: ProjectRef[], sourceCount?: number, projectCount?: number,
 *   extra?: HTMLElement[],
 * }} o
 */
export function shell(o) {
  const nav = h(
    'nav.nav',
    { 'aria-label': 'Main' },
    h('a.brand', { href: '/' }, h('span.logo'), h('span', null, o.team)),
  );
  if (o.project) {
    const p = o.project;
    const switcher = h(
      'button.switcher',
      { type: 'button', 'aria-haspopup': 'menu', 'data-testid': 'project-switcher' },
      h('span', null, p.name),
      h('span.muted.tiny', null, '▾'),
    );
    switcher.addEventListener('click', () => {
      const page = location.pathname;
      popMenu(
        switcher,
        (o.projects ?? [p]).map((x) =>
          h(
            'a.mono',
            {
              href: `${page}?project=${encodeURIComponent(x.id)}`,
              'aria-current': x.id === p.id ? 'true' : null,
            },
            x.name,
          ),
        ),
      );
    });
    const q = `?project=${encodeURIComponent(p.id)}`;
    nav.append(
      h('div.section', null, 'Project'),
      switcher,
      navLink(`/tail${q}`, 'tail', 'Live tail', o.active === 'tail'),
      navLink(`/dashboard${q}`, 'chart', 'Dashboards', o.active === 'dashboards'),
      navLink(`/connect${q}`, 'plug', 'Sources', o.active === 'sources', o.sourceCount),
    );
  } else {
    nav.append(
      h('div.section', null, 'Workspace'),
      navLink('/', 'grid', 'Projects', o.active === 'projects', o.projectCount),
      navLink('/#team', 'team', 'Team', false),
      h('a.item', { 'aria-disabled': 'true', title: 'Settings (coming soon)' }, icon('settings'), 'Settings'),
    );
  }
  for (const el of o.extra ?? []) nav.append(el);
  nav.append(h('div.grow'), themeButton());
  if (o.project) nav.append(h('a.item', { href: '/' }, '← All projects'));
  nav.append(
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
 * @param {string} title
 * @param {(Node | string | null)[]} meta
 * @param {(Node | null)[]} actions
 */
export function topbar(title, meta, actions) {
  return h(
    'header.topbar',
    null,
    h('div.title', null, h('h1', null, title), ...meta),
    h('div.actions', null, ...actions),
  );
}

/** Reads `?project=` and loads that project plus the project list for the switcher. */
export async function loadProjectContext() {
  const id = new URLSearchParams(location.search).get('project');
  const { projects } = await api('/api/projects');
  const project = projects.find((/** @type {ProjectRef} */ p) => p.id === id);
  if (!project) {
    location.href = '/';
    throw new Error('unknown project');
  }
  return { project, projects };
}
