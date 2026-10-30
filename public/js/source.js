// Source detail (/source?project=…&id=…): stats, how to send, rename, regenerate token, delete.
import { api, ApiError } from './api.js';
import { confirmDelete, formDialog, h, icon, modal, mount } from './dom.js';
import { ago, hms, num } from './format.js';
import { sendPanel } from './sendpanel.js';
import { page, topbar } from './shell.js';

const DAY = 86_400_000;
let project = /** @type {any} */ (null);
let source = /** @type {any} */ (null);
const body = h('div.page');
const titleEl = h('div.crumbs');

/** @param {string} label @param {Node | string} value */
function stat(label, value) {
  return h('div.stat', null, h('span.tiny.muted', null, label), h('span', null, value));
}

async function events24h() {
  const now = Date.now();
  try {
    const r = await api('/api/aggregate', {
      body: {
        project_id: project.id,
        from: now - DAY,
        to: now + 1000,
        where: [{ field: 'source', op: '=', value: source.name }],
        measure: 'count',
        parts: ['value'],
      },
    });
    return num(r.value ?? 0);
  } catch {
    return '—';
  }
}

async function render() {
  const tail = `/tail?project=${encodeURIComponent(project.id)}&source=${encodeURIComponent(source.name)}`;
  mount(
    titleEl,
    h('a.muted', { href: `/sources?project=${encodeURIComponent(project.id)}` }, 'Sources'),
    h('span.muted', null, ' / '),
    h('h1.mono', null, source.name),
    h(
      'button.iconbtn',
      { type: 'button', 'aria-label': 'Rename source', title: 'Rename', onclick: rename },
      icon('edit', 14),
    ),
  );
  const rejected = source.rejected_count > 0;
  const count = h('span', null, '…');
  mount(
    body,
    h(
      'div.stats-row',
      null,
      stat('Created', `${new Date(source.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`),
      stat(
        'Last event',
        source.last_event_at ? `${ago(source.last_event_at)} (${hms(source.last_event_at)} UTC)` : 'never',
      ),
      stat('Events · 24h', count),
      stat(
        'Rejected requests',
        rejected
          ? h('span.bad', null, `${num(source.rejected_count)} · last ${hms(source.last_rejected_at)} UTC`)
          : '0',
      ),
    ),
    rejected && source.last_rejected_at > (source.last_event_at ?? 0)
      ? h(
          'div.alert.err',
          { role: 'alert' },
          icon('info'),
          h(
            'div.body',
            null,
            h('strong', null, 'Requests are being rejected'),
            h(
              'span',
              null,
              'Apps are sending with an old token (401 invalid token). Update them with the current token, or regenerate it.',
            ),
          ),
        )
      : null,
    h(
      'section.card.panel',
      null,
      h(
        'div.spread',
        null,
        h('h2', null, 'How to send logs'),
        h('a.btn', { href: tail }, 'Open live tail →'),
      ),
      sendPanel({ sourceName: source.name, tokenPrefix: source.token_prefix }),
    ),
  );
  const recent = source.last_event_at && Date.now() - source.last_event_at < 5 * 60_000;
  count.replaceWith(
    h(
      'span',
      null,
      h('span', { 'data-testid': 'events-24h' }, await events24h()),
      recent ? h('span.tiny.muted', null, ' · new events take 1–3 minutes to appear') : null,
    ),
  );
}

async function rename() {
  const input = h('input.input.mono#sname', {
    name: 'name',
    required: true,
    maxlength: 64,
    value: source.name,
  });
  await formDialog(
    'Rename source',
    [
      h('div.field', null, h('label.label', { for: 'sname' }, 'Name'), input),
      h('p.small.muted', null, 'New events get the new name. Events already stored keep the old one.'),
    ],
    'Rename',
    async (v) => {
      try {
        source = (await api(`/api/sources/${source.id}`, { method: 'PATCH', body: { name: v.name } })).source;
        render();
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Rename failed';
      }
    },
  );
}

async function regenerate() {
  const ok = await formDialog(
    `Regenerate token for ${source.name}?`,
    [
      h(
        'p.small.muted',
        null,
        'The current token stops working immediately. Apps using it get 401 until you update them.',
      ),
    ],
    'Regenerate token',
  );
  if (!ok) return;
  const res = await api(`/api/sources/${source.id}/regenerate`, { method: 'POST' });
  source = res.source;
  render();
  modal(
    'New token',
    () => [
      h('p.small', null, 'Update your apps with this token:'),
      sendPanel({ sourceName: source.name, token: res.token }),
    ],
    { wide: true },
  );
}

async function remove() {
  await confirmDelete({
    title: `Delete source ${source.name}?`,
    body: 'Its token stops working right away, so apps sending with it get 401. Logs already stored stay.',
    confirmLabel: 'Delete source',
    onConfirm: async () => {
      try {
        await api(`/api/sources/${source.id}`, { method: 'DELETE' });
        location.href = `/sources?project=${encodeURIComponent(project.id)}`;
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Delete failed';
      }
    },
  });
}

async function main() {
  const ctx = await page('sources');
  project = ctx.project;
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const res = await api(`/api/sources/${encodeURIComponent(id)}`).catch(() => null);
  if (!res) {
    location.href = `/sources?project=${encodeURIComponent(project.id)}`;
    return;
  }
  source = res.source;
  ctx.main.append(
    topbar(
      titleEl,
      [],
      [
        h('button.btn', { type: 'button', onclick: regenerate }, 'Regenerate token'),
        ctx.me.role !== 'member'
          ? h('button.btn.danger', { type: 'button', onclick: remove }, 'Delete')
          : null,
      ],
    ),
    body,
  );
  await render();
}

main();
