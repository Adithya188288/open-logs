// Sources (/sources): the project's sources, and a modal to create one.
import { api, ApiError } from './api.js';
import { h, icon, modal, mount } from './dom.js';
import { ago, lagLabel } from './format.js';
import { sendPanel } from './sendpanel.js';
import { page, topbar } from './shell.js';

const POLL_MS = 3000;
let project = /** @type {any} */ (null);
let lagMs = 0;
const listEl = h('div');

/** @param {any} s */
function statusPill(s) {
  const rejecting = s.rejected_count > 0 && (!s.last_event_at || s.last_rejected_at > s.last_event_at);
  if (rejecting)
    return h(
      'span.pill.err',
      { title: `${s.rejected_count} requests rejected with 401` },
      `${s.rejected_count} rejected`,
    );
  if (s.last_event_at) return h('span.pill.ok', null, 'Receiving');
  return h('span.pill', null, 'Waiting for first event');
}

/** @param {any} s */
function detailHref(s) {
  return `/source?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(s.id)}`;
}

async function render() {
  const { sources } = await api(`/api/projects/${project.id}/sources`);
  const count = document.querySelector('.nav a[href^="/sources"] .count');
  if (count) count.textContent = String(sources.length);
  if (!sources.length) {
    mount(
      listEl,
      h(
        'div.empty',
        { 'data-testid': 'no-sources' },
        h('h2', null, 'Add your first source'),
        h(
          'p.small',
          null,
          'A source is one service or app that sends logs, like api, worker or web. Each gets its own token.',
        ),
        h('button.btn.primary', { type: 'button', onclick: newSource }, icon('plus', 14), 'New source'),
      ),
    );
    return;
  }
  mount(
    listEl,
    h(
      'section.card.sources',
      { 'aria-label': 'Sources' },
      h(
        'table.grid.clickable',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ...['Name', 'Token', 'Last event', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)),
          ),
        ),
        h(
          'tbody',
          null,
          ...sources.map((/** @type {any} */ s) =>
            h(
              'tr',
              { 'data-testid': 'source-row', onclick: () => (location.href = detailHref(s)) },
              h('td', null, h('a.mono', { href: detailHref(s) }, s.name)),
              h('td', null, h('code.small.muted', null, `${s.token_prefix}…`)),
              h('td', null, h('span.small.muted', null, s.last_event_at ? ago(s.last_event_at) : 'never')),
              h('td', null, statusPill(s)),
              h('td.right', null, icon('right', 14)),
            ),
          ),
        ),
      ),
    ),
  );
}

/** New source: name → snippet with the one-time token → listening for the first event. */
function newSource() {
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let poll;
  const dialog = modal(
    'New source',
    () => {
      const name = h('input.input.mono#svc', {
        name: 'name',
        required: true,
        maxlength: 64,
        placeholder: 'api',
        autocomplete: 'off',
      });
      const error = h('p.error-text', { role: 'alert' });
      const form = h(
        'form.field',
        null,
        h('label.label', { for: 'svc' }, 'Name'),
        h('span.small.muted', null, 'One source per service. Its events are tagged with this name.'),
        h('div.rowline', null, name, h('button.btn.primary', { type: 'submit' }, 'Create source')),
        error,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api(`/api/projects/${project.id}/sources`, {
            body: { name: /** @type {HTMLInputElement} */ (name).value },
          });
          showToken(res.source, res.token);
          render();
        } catch (err) {
          error.textContent = err instanceof ApiError ? err.message : 'Could not create the source';
        }
      });
      return [form];
    },
    { wide: true, onClose: () => clearInterval(poll) },
  );

  /**
   * @param {any} source
   * @param {string} token
   */
  function showToken(source, token) {
    const verify = h('div.verify.listening', { role: 'status', 'data-testid': 'verify' });
    const setVerify = (/** @type {boolean} */ got) => {
      verify.className = `verify ${got ? 'got' : 'listening'}`;
      mount(
        verify,
        h('span.beacon', { 'aria-hidden': 'true' }, h('span.ring'), h('span')),
        h(
          'div.text',
          null,
          h(
            'span',
            null,
            got ? 'First event received from ' : 'Listening for the first event from ',
            h('span.mono', null, source.name),
            got ? '' : '…',
          ),
          h(
            'span',
            null,
            got
              ? 'You’re connected.'
              : `${lagMs > 0 ? `Events land ${lagLabel(lagMs).replace('~', 'about ')} after they’re sent.` : 'Events show up within seconds.'} This updates on its own.`,
          ),
        ),
        h(
          'a.btn',
          {
            href: `/tail?project=${encodeURIComponent(project.id)}&source=${encodeURIComponent(source.name)}`,
          },
          'Open live tail →',
        ),
      );
    };
    setVerify(false);
    const content = [
      h('p.small', null, 'Source ', h('b.mono', null, source.name), ' created. Send it one event:'),
      sendPanel({ sourceName: source.name, token }),
      verify,
      h(
        'div.row',
        null,
        h(
          'a.btn',
          { href: `/source?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(source.id)}` },
          'Source details',
        ),
        h('button.btn.primary', { type: 'button', onclick: () => dialog.close() }, 'Done'),
      ),
    ];
    dialog.box.querySelector('form')?.replaceWith(...content);
    poll = setInterval(async () => {
      const res = await api(`/api/sources/${source.id}`).catch(() => null);
      if (res?.source.last_event_at) {
        clearInterval(poll);
        setVerify(true);
        render();
      }
    }, POLL_MS);
  }
}

async function main() {
  const ctx = await page('sources');
  project = ctx.project;
  lagMs = (await api('/api/status')).lag_ms;
  ctx.main.append(
    topbar(
      'Sources',
      [h('span.small.muted', null, project.name)],
      [h('button.btn.primary', { type: 'button', onclick: newSource }, icon('plus', 14), 'New source')],
    ),
    h('div.page', null, listEl),
  );
  await render();
  if (new URLSearchParams(location.search).get('new') === '1') newSource();
}

main();
