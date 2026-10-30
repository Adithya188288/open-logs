// All projects (/projects): one card per project, with rename and delete.
import { api, ApiError } from './api.js';
import { confirmDelete, formDialog, h, icon, mount, popMenu, s, toast } from './dom.js';
import { ago, compact, num } from './format.js';
import { newProjectDialog, page, projectHome, topbar } from './shell.js';

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

/**
 * @param {any} p
 * @param {import('./shell.js').Me} me
 */
function projectCard(p, me) {
  const st = status(p);
  const more = h(
    'button.iconbtn',
    { type: 'button', 'aria-label': `Options for ${p.name}`, 'aria-haspopup': 'menu' },
    icon('more'),
  );
  more.addEventListener('click', () =>
    popMenu(
      more,
      [
        h('a', { href: projectHome(p.id), role: 'menuitem' }, 'Open'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => rename(p) }, 'Rename'),
        me.role !== 'member'
          ? h(
              'button.danger',
              { type: 'button', role: 'menuitem', onclick: () => remove(p) },
              'Delete project',
            )
          : null,
      ].filter(Boolean),
    ),
  );
  return h(
    'article.card.project',
    { 'data-testid': 'project-card' },
    h(
      'div.head',
      null,
      h('a.name', { href: projectHome(p.id) }, p.name),
      h(
        'div.headr',
        null,
        h(`span.pill${st.cls ? `.${st.cls}` : ''}`, null, h(`span.${st.dot}`), st.label),
        more,
      ),
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
      p.sources.length
        ? h('div.tags', null, ...p.sources.map((/** @type {any} */ src) => h('span.tag', null, src.name)))
        : h(
            'a.btn',
            { href: `/sources?project=${encodeURIComponent(p.id)}` },
            icon('plug', 14),
            'Add a source',
          ),
      h(
        'span.seen',
        null,
        p.last_event_at ? `Last event ${ago(p.last_event_at)}` : `Created ${ago(p.created_at)}`,
      ),
    ),
  );
}

/** @param {any} p */
async function rename(p) {
  const input = h('input.input.mono#rname', { name: 'name', required: true, maxlength: 64, value: p.name });
  await formDialog(
    'Rename project',
    [h('div.field', null, h('label.label', { for: 'rname' }, 'Project name'), input)],
    'Rename',
    async (v) => {
      try {
        await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: v.name } });
        location.reload();
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Rename failed';
      }
    },
  );
}

/** @param {any} p */
async function remove(p) {
  await confirmDelete({
    title: `Delete project ${p.name}?`,
    body: 'This deletes its sources (their tokens stop working), dashboards and saved views. Logs already in Basin stay in R2.',
    confirmLabel: 'Delete project',
    onConfirm: async () => {
      try {
        await api(`/api/projects/${p.id}`, { method: 'DELETE' });
        toast('Project deleted');
        location.reload();
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Delete failed';
      }
    },
  });
}

async function main() {
  const { me, main } = await page('projects', { required: false });
  const { projects } = await api('/api/projects');
  const live = projects.filter((/** @type {any} */ p) => status(p).cls === 'ok').length;
  const find = h('input#find', { type: 'search', placeholder: 'Find a project' });
  const grid = h('div.projects', { 'data-testid': 'projects' });
  const render = () => {
    const q = /** @type {HTMLInputElement} */ (find).value.trim().toLowerCase();
    mount(
      grid,
      ...projects
        .filter((/** @type {any} */ p) => p.name.toLowerCase().includes(q))
        .map((/** @type {any} */ p) => projectCard(p, me)),
    );
  };
  find.addEventListener('input', render);
  render();
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
        h(
          'button.btn.primary',
          { type: 'button', onclick: newProjectDialog },
          icon('plus', 14),
          'New project',
        ),
      ],
    ),
    h('div.page', null, grid),
  );
}

main();
