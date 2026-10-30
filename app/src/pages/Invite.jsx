// Accept an invite: the token lives in the URL fragment (/invite#ol_inv_…).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Loader } from '../components/Loader.jsx';
import { ThemeButton } from '../components/ThemeButton.jsx';
import { ApiError, api } from '../lib/api.js';

export function Invite() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [state, setState] = useState(
    /** @type {'loading' | 'invalid' | { team: string, email: string, role: string }} */ ('loading'),
  );
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api(`/api/invites/${encodeURIComponent(token)}`, { redirectOn401: false })
      .then((d) => setState({ team: d.team_name, email: d.invite.email, role: d.invite.role }))
      .catch(() => setState('invalid'));
  }, [token]);

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    try {
      await api(`/api/invites/${encodeURIComponent(token)}/accept`, {
        body: { name: form.get('name'), password: form.get('password') },
        redirectOn401: false,
      });
      window.history.replaceState(null, '', '/invite');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    }
  }

  return (
    <div className="auth">
      <div className="toggle">
        <ThemeButton />
      </div>
      {state === 'loading' ? (
        <Loader size="lg" label="Checking your invite" />
      ) : state === 'invalid' ? (
        <form>
          <span className="logo" aria-hidden="true" />
          <h1>Invite not valid</h1>
          <p>This invite link is invalid, already used, or expired. Ask a team admin for a new one.</p>
          <Link className="btn primary" to="/login">
            Go to sign in
          </Link>
        </form>
      ) : (
        <form onSubmit={submit}>
          <span className="logo" aria-hidden="true" />
          <div className="field">
            <h1>Join {state.team}</h1>
            <p>
              You were invited as {state.role} with <span className="mono">{state.email}</span>.
            </p>
          </div>
          {error && (
            <div className="alert err" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="input"
              name="name"
              autoComplete="name"
              required
              autoFocus
              maxLength={80}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Choose a password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <span className="tiny muted">At least 8 characters.</span>
          </div>
          <button className="btn primary" type="submit">
            Join team
          </button>
        </form>
      )}
    </div>
  );
}
