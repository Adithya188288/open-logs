// Projects + team page (/).
import { api, ApiError } from './api.js';
import { copyText, formDialog, h, icon, mount, s, toast } from './dom.js';
import { ago, cap, compact, initials, num } from './format.js';
import { boot, shell, topbar } from './shell.js';

const LIVE_MS = 15 * 60 * 1000;

/** @param {{ last_event_at: number | null }} p */
function status(p) {
  if (!p.last_event_at) return { label: 'Waiting for data', cls: '', dot: 'dot.idle' };
  if (Date.now() - p.last_event_at < LIVE_MS) return { label: 'Live', cls: 'ok', dot: 'dot.live' };
  return { label: 'Idle', cls: '', dot: 'dot.off' };
}

/** @param {number[]} values */
function sparkline(values) {
  const max = Math.max(...values);
  const svg = s('svg', { viewBox: '0 0 240 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (!max) {
    svg.append(s('polyline', { class: 'empty', points: '0,36 240,36' }));
    return svg;
  }
  const pts = values.map(
    (v, i) => `${Math.round((i * 240) / (values.length - 1))},${37 - Math.round((v / max) * 32)}`,
  );
  svg.append(s('polyline', { points: pts.join(' ') }));
  return svg;
}

/** @param {any} p */
function projectCard(p) {
  const st = status(p);
  const hasSources = p.sources.length > 0;
  const href = hasSources
    ? `/tail?project=${encodeURIComponent(p.id)}`
    : `/connect?project=${encodeURIComponent(p.id)}`;
  return h(
    'article.card.project',
    { 'data-testid': 'project-card' },
    h(
      'div.head',
      null,
      h('a.name', { href }, p.name),
      h(`span.pill${st.cls ? `.${st.cls}` : ''}`, null, h(`span.${st.dot}`), st.label),
    ),
    sparkline(p.stats.spark),
    h(
      'div.stats',
      null,
      h('span', null, h('b', null, compact(p.stats.events_24h)), ' events · 24h'),
      h(
        'span',
        null,
        h(`b${p.stats.errors_24h > 0 ? '.bad' : ''}`, null, num(p.stats.errors_24h)),
        ' errors',
      ),
    ),
    h(
      'div.foot',
      null,
      hasSources
        ? h('div.tags', null, ...p.sources.map((/** @type {any} */ src) => h('span.tag', null, src.name)))
        : h(
            'a.btn',
            { href: `/connect?project=${encodeURIComponent(p.id)}` },
            icon('plug', 14),
            'Connect a source',
          ),
      h(
        'span.seen',
        null,
        p.last_event_at ? `Last event ${ago(p.last_event_at)}` : `Created ${ago(p.created_at)}`,
      ),
    ),
  );
}

async function newProject() {
  const input = h('input.input.mono#pname', {
    name: 'name',
    required: true,
    maxlength: 64,
    placeholder: 'checkout-app',
    autocomplete: 'off',
  });
  await formDialog(
    'New project',
    [h('div.field', null, h('label.label', { for: 'pname' }, 'Project name'), input)],
    'Create project',
    async (v) => {
      try {
        const { project } = await api('/api/projects', { body: { name: v.name } });
        location.href = `/connect?project=${encodeURIComponent(project.id)}`;
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Could not create the project';
      }
    },
  );
}

/**
 * @param {import('./shell.js').Me} me
 */
async function teamSection(me) {
  const section = h('section.card.team#team', { 'aria-labelledby': 'team-h' });
  const canInvite = me.role !== 'member';

  async function render(/** @type {string | null} */ inviteUrl = null) {
    const { users, invites } = await api('/api/users');
    const email = h('input.input#inv', {
      type: 'email',
      placeholder: 'teammate@company.com',
      required: true,
      name: 'email',
    });
    const role = h(
      'select.select#role',
      { name: 'role' },
      h('option', { value: 'member' }, 'Member'),
      h('option', { value: 'admin' }, 'Admin'),
    );
    const form = h(
      'form.invite',
      { 'aria-label': 'Invite a teammate' },
      h('label.sr', { for: 'inv' }, 'Teammate email'),
      email,
      h('label.sr', { for: 'role' }, 'Role'),
      role,
      h('button.btn', { type: 'submit' }, 'Invite'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/invites', {
          body: {
            email: /** @type {HTMLInputElement} */ (email).value,
            role: /** @type {HTMLSelectElement} */ (role).value,
          },
        });
        render(res.invite_url);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Invite failed');
      }
    });

    const rows = [
      ...users.map((/** @type {any} */ u) =>
        h(
          'tr',
          null,
          h(
            'td',
            null,
            h('span.who', null, h('span.avatar.sm', { 'aria-hidden': 'true' }, initials(u.name)), u.name),
          ),
          h('td', null, h('span.email', null, u.email)),
          h('td', null, h('span.pill', null, cap(u.role))),
          h(
            'td',
            null,
            h(
              'span.small.muted',
              null,
              u.last_active_at
                ? Date.now() - u.last_active_at < 120_000
                  ? 'now'
                  : ago(u.last_active_at)
                : '—',
            ),
          ),
          h(
            'td',
            null,
            me.role === 'owner' && u.id !== me.id
              ? h('button.btn.link.danger.tiny', { type: 'button', onclick: () => removeUser(u) }, 'Remove')
              : null,
          ),
        ),
      ),
      ...invites.map((/** @type {any} */ i) =>
        h(
          'tr',
          null,
          h(
            'td',
            null,
            h('span.who.muted', null, h('span.avatar.sm', { 'aria-hidden': 'true' }, '?'), 'Invited'),
          ),
          h('td', null, h('span.email', null, i.email)),
          h('td', null, h('span.pill.warn', null, cap(i.role))),
          h(
            'td',
            null,
            h('span.small.muted', null, `expires ${new Date(i.expires_at).toISOString().slice(0, 10)}`),
          ),
          h('td'),
        ),
      ),
    ];

    mount(
      section,
      h(
        'div.bar',
        null,
        h(
          'div',
          null,
          h('h2#team-h', null, 'Team'),
          h('p', null, 'Everyone here can see every project in this deploy.'),
        ),
        canInvite ? form : null,
      ),
      inviteUrl
        ? h(
            'div.invite-link',
            { role: 'status' },
            h('span', null, 'Invite link (shown once, valid 7 days):'),
            h('code', { 'data-testid': 'invite-url' }, inviteUrl),
            h(
              'button.btn',
              {
                type: 'button',
                onclick: async () => toast((await copyText(inviteUrl)) ? 'Copied' : 'Copy failed'),
              },
              icon('copy', 13),
              'Copy link',
            ),
          )
        : null,
      h(
        'table.grid',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, 'Name'),
            h('th', { scope: 'col' }, 'Email'),
            h('th', { scope: 'col' }, 'Role'),
            h('th', { scope: 'col' }, 'Last active'),
            h('th', { scope: 'col' }, h('span.sr', null, 'Actions')),
          ),
        ),
        h('tbody', null, ...rows),
      ),
    );
  }

  /** @param {any} u */
  async function removeUser(u) {
    const ok = await formDialog(
      `Remove ${u.name}?`,
      [h('p.small.muted', null, `${u.email} will be signed out and lose access.`)],
      'Remove',
    );
    if (!ok) return;
    await api(`/api/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
    render();
  }

  await render();
  return section;
}

async function main() {
  const { user: me, team_name } = await boot();
  const { projects } = await api('/api/projects');
  const { main } = shell({ me, team: team_name, active: 'projects', projectCount: projects.length });
  const live = projects.filter((/** @type {any} */ p) => status(p).cls === 'ok').length;

  const find = h('input#find', { type: 'search', placeholder: 'Find a project' });
  const grid = h('div.projects', { 'data-testid': 'projects' });
  const renderGrid = () => {
    const q = /** @type {HTMLInputElement} */ (find).value.trim().toLowerCase();
    const shown = projects.filter((/** @type {any} */ p) => p.name.toLowerCase().includes(q));
    if (!projects.length) {
      mount(
        grid,
        h(
          'div.empty-projects',
          null,
          h('h2', null, 'No projects yet'),
          h('p.small', null, 'A project groups the sources (apps and services) that send it logs.'),
          h('button.btn.primary', { type: 'button', onclick: newProject }, icon('plus', 14), 'New project'),
        ),
      );
    } else mount(grid, ...shown.map(projectCard));
  };
  find.addEventListener('input', renderGrid);
  renderGrid();

  main.append(
    topbar(
      'Projects',
      [
        h(
          'span.small.muted',
          null,
          `${projects.length} project${projects.length === 1 ? '' : 's'} · ${live} live`,
        ),
      ],
      [
        h('div.searchbox', null, icon('search', 15), h('label.sr', { for: 'find' }, 'Find a project'), find),
        h('button.btn.primary', { type: 'button', onclick: newProject }, icon('plus', 14), 'New project'),
      ],
    ),
    h('div.page', null, grid, await teamSection(me)),
  );
  if (location.hash === '#team') document.getElementById('team')?.scrollIntoView();
}

main();
