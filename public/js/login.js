// Sign-in page. First sign-in on a fresh deploy uses the ADMIN_PASSWORD secret.
import { api, ApiError } from './api.js';
import { h } from './dom.js';
import { themeButton } from './shell.js';

/** Only same-origin paths are allowed as a post-login destination. */
function nextPath() {
  const next = new URLSearchParams(location.search).get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

async function main() {
  const { team_name } = await api('/api/config').catch(() => ({ team_name: 'Open Logs' }));
  document.title = `Sign in · ${team_name}`;
  const error = h('div.alert.err', { role: 'alert', hidden: true });
  const email = h('input.input#email', {
    type: 'email',
    name: 'email',
    autocomplete: 'username',
    required: true,
    autofocus: true,
  });
  const password = h('input.input#password', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    required: true,
  });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Sign in');
  const form = h(
    'form',
    { 'aria-labelledby': 'signin-h' },
    h('span.logo', { 'aria-hidden': 'true' }),
    h(
      'div.field',
      null,
      h('h1#signin-h', null, `Sign in to ${team_name}`),
      h('p', null, 'Logs for your team, on your own Cloudflare account.'),
    ),
    error,
    h('div.field', null, h('label.label', { for: 'email' }, 'Email'), email),
    h(
      'div.field',
      null,
      h(
        'div.spread',
        null,
        h('label.label', { for: 'password' }, 'Password'),
        h('span.tiny.muted', { title: 'Ask a team admin to send you a new invite' }, 'Forgot? Ask an admin'),
      ),
      password,
    ),
    submit,
    h('div.foot', null, 'First sign-in uses the ', h('b', null, 'ADMIN_PASSWORD'), ' secret set at deploy.'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.setAttribute('disabled', '');
    try {
      await api('/api/auth/login', {
        body: {
          email: /** @type {HTMLInputElement} */ (email).value,
          password: /** @type {HTMLInputElement} */ (password).value,
        },
        redirectOn401: false,
      });
      location.href = nextPath();
    } catch (err) {
      error.textContent =
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : err instanceof ApiError
            ? err.message
            : 'Could not reach the server.';
      error.hidden = false;
      submit.removeAttribute('disabled');
    }
  });
  document.body.replaceChildren(h('div.auth', null, h('div.toggle', null, themeButton('btn')), form));
}

main();
