// Team (/team): members, pending invites, invite a teammate.
import { api, ApiError } from './api.js';
import { confirmDelete, copyText, formDialog, h, icon, modal, mount, toast } from './dom.js';
import { ago, cap, initials } from './format.js';
import { page, topbar } from './shell.js';

/** @type {import('./shell.js').Me} */
let me;
const body = h('div.page');

async function render() {
  const { users, invites } = await api('/api/users');
  const rows = [
    ...users.map((/** @type {any} */ u) =>
      h(
        'tr',
        { 'data-testid': 'member-row' },
        h(
          'td',
          null,
          h(
            'span.who',
            null,
            h('span.avatar.sm', { 'aria-hidden': 'true' }, initials(u.name)),
            u.name,
            u.id === me.id ? h('span.muted.small', null, ' (you)') : null,
          ),
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
          'td.right',
          null,
          me.role === 'owner' && u.id !== me.id
            ? h('button.btn.danger', { type: 'button', onclick: () => removeUser(u) }, 'Remove')
            : null,
        ),
      ),
    ),
    ...invites.map((/** @type {any} */ i) =>
      h(
        'tr',
        { 'data-testid': 'invite-row' },
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
    body,
    h(
      'section.card.team',
      { 'aria-label': 'Team members' },
      h(
        'table.grid',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ...['Name', 'Email', 'Role', 'Last active', ''].map((t) => h('th', { scope: 'col' }, t)),
          ),
        ),
        h('tbody', null, ...rows),
      ),
    ),
    h(
      'p.small.muted',
      null,
      'Everyone on the team can see every project. Admins can invite people and delete projects or sources.',
    ),
  );
}

async function invite() {
  const email = h('input.input#inv', {
    type: 'email',
    name: 'email',
    required: true,
    placeholder: 'teammate@company.com',
  });
  const role = h(
    'select.select#role',
    { name: 'role' },
    h('option', { value: 'member' }, 'Member'),
    h('option', { value: 'admin' }, 'Admin'),
  );
  /** @type {any} */
  let result = null;
  await formDialog(
    'Invite a teammate',
    [
      h('div.field', null, h('label.label', { for: 'inv' }, 'Email'), email),
      h('div.field', null, h('label.label', { for: 'role' }, 'Role'), role),
    ],
    'Send invite',
    async (v) => {
      try {
        result = await api('/api/invites', { body: { email: v.email, role: v.role } });
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Invite failed';
      }
    },
  );
  if (!result) return;
  render();
  modal('Invite created', () => [
    h(
      'p.small',
      { 'data-testid': 'invite-email-status' },
      result.email.sent
        ? `We emailed the invite to ${result.invite.email}. You can also share this link yourself:`
        : `Email sending isn’t set up, so share this link with ${result.invite.email} yourself:`,
    ),
    h('code.invite-url', { 'data-testid': 'invite-url' }, result.invite_url),
    h('p.tiny.muted', null, 'The link works once and expires in 7 days.'),
    h(
      'div.row',
      null,
      h(
        'button.btn.primary',
        {
          type: 'button',
          onclick: async () => toast((await copyText(result.invite_url)) ? 'Link copied' : 'Copy failed'),
        },
        icon('copy', 13),
        'Copy link',
      ),
    ),
  ]);
}

/** @param {any} u */
async function removeUser(u) {
  await confirmDelete({
    title: `Remove ${u.name}?`,
    body: `${u.email} is signed out everywhere and loses access. Invites they sent are cancelled.`,
    confirmLabel: 'Remove teammate',
    onConfirm: async () => {
      try {
        await api(`/api/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
        render();
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Remove failed';
      }
    },
  });
}

async function main() {
  const ctx = await page('team', { required: false });
  me = ctx.me;
  ctx.main.append(
    topbar(
      'Team',
      [],
      [
        me.role !== 'member'
          ? h('button.btn.primary', { type: 'button', onclick: invite }, icon('plus', 14), 'Invite teammate')
          : null,
      ],
    ),
    body,
  );
  await render();
}

main();
