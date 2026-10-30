// Accept an invite: the token lives in the URL fragment (/invite#ol_inv_…).
import { api, ApiError } from './api.js';
import { h } from './dom.js';
import { themeButton } from './shell.js';

async function main() {
  const token = location.hash.slice(1);
  let invite;
  let team = 'Open Logs';
  try {
    const data = await api(`/api/invites/${encodeURIComponent(token)}`, { redirectOn401: false });
    invite = data.invite;
    team = data.team_name;
  } catch {
    document.body.replaceChildren(
      h(
        'div.auth',
        null,
        h(
          'form',
          null,
          h('span.logo', { 'aria-hidden': 'true' }),
          h('h1', null, 'Invite not valid'),
          h(
            'p',
            null,
            'This invite link is invalid, already used, or expired. Ask a team admin for a new one.',
          ),
          h('a.btn.primary', { href: '/login' }, 'Go to sign in'),
        ),
      ),
    );
    return;
  }
  const error = h('div.alert.err', { role: 'alert', hidden: true });
  const name = h('input.input#name', {
    name: 'name',
    autocomplete: 'name',
    required: true,
    autofocus: true,
    maxlength: 80,
  });
  const password = h('input.input#password', {
    type: 'password',
    name: 'password',
    autocomplete: 'new-password',
    required: true,
    minlength: 8,
  });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Join team');
  const form = h(
    'form',
    null,
    h('span.logo', { 'aria-hidden': 'true' }),
    h(
      'div.field',
      null,
      h('h1', null, `Join ${team}`),
      h('p', null, `You were invited as ${invite.role} with `, h('span.mono', null, invite.email), '.'),
    ),
    error,
    h('div.field', null, h('label.label', { for: 'name' }, 'Your name'), name),
    h(
      'div.field',
      null,
      h('label.label', { for: 'password' }, 'Choose a password'),
      password,
      h('span.tiny.muted', null, 'At least 8 characters.'),
    ),
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    try {
      await api(`/api/invites/${encodeURIComponent(token)}/accept`, {
        body: {
          name: /** @type {HTMLInputElement} */ (name).value,
          password: /** @type {HTMLInputElement} */ (password).value,
        },
        redirectOn401: false,
      });
      history.replaceState(null, '', '/invite');
      location.href = '/';
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Could not reach the server.';
      error.hidden = false;
    }
  });
  document.body.replaceChildren(h('div.auth', null, h('div.toggle', null, themeButton('btn')), form));
}

main();
