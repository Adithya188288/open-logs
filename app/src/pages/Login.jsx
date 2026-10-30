// Sign-in. First sign-in on a fresh deploy uses the ADMIN_PASSWORD secret.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ThemeButton } from '../components/ThemeButton.jsx';
import { ApiError, api } from '../lib/api.js';

/** Only same-origin paths are allowed as a post-login destination. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next') ?? '/';
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

export function Login() {
  const [team, setTeam] = useState('Open Logs');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api('/api/config', { redirectOn401: false })
      .then((c) => setTeam(c.team_name))
      .catch(() => {});
  }, []);

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/login', {
        body: { email: form.get('email'), password: form.get('password') },
        redirectOn401: false,
      });
      navigate(nextPath(), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : err instanceof ApiError
            ? err.message
            : 'Could not reach the server.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="toggle">
        <ThemeButton />
      </div>
      <form aria-labelledby="signin-h" onSubmit={submit}>
        <span className="logo" aria-hidden="true" />
        <div className="field">
          <h1 id="signin-h">Sign in to {team}</h1>
          <p>Logs for your team, on your own Cloudflare account.</p>
        </div>
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        <div className="field">
          <div className="spread">
            <label className="label" htmlFor="password">
              Password
            </label>
            <span className="tiny muted" title="Ask a team admin to send you a new invite">
              Forgot? Ask an admin
            </span>
          </div>
          <input
            id="password"
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="foot">
          First sign-in uses the <b>ADMIN_PASSWORD</b> secret set at deploy.
        </div>
      </form>
    </div>
  );
}
