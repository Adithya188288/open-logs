// Settings (/settings): team name and your password.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../components/Dialogs.jsx';
import { PageLoader, Topbar, useApp } from '../components/Layout.jsx';
import { ApiError, api } from '../lib/api.js';
import { q, queryClient } from '../lib/queries.js';

/**
 * @param {{ title: string, hint: string, submitLabel: string, readOnly?: boolean, onSubmit: (form: HTMLFormElement) => Promise<string | null>, children: import('react').ReactNode }} props
 */
function Section({ title, hint, submitLabel, readOnly, onSubmit, children }) {
  const [error, setError] = useState('');
  return (
    <form
      className="card settings"
      aria-label={title}
      onSubmit={async (e) => {
        e.preventDefault();
        setError((await onSubmit(e.currentTarget)) ?? '');
      }}
    >
      <div>
        <h2>{title}</h2>
        <p className="small muted">{hint}</p>
      </div>
      {children}
      <p className="error-text" role="alert">
        {error}
      </p>
      {!readOnly && (
        <div>
          <button className="btn" type="submit">
            {submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}

export function Settings() {
  const { me, setTeam } = useApp();
  const { data: settings } = useQuery(q.settings());
  const [edited, setTeamName] = useState(/** @type {string | null} */ (null));
  const teamName = edited ?? settings?.team_name ?? null;
  const isAdmin = me.role !== 'member';

  return (
    <>
      <Topbar title="Settings" />
      {teamName === null ? (
        <PageLoader />
      ) : (
        <div className="page narrow">
          <Section
            title="Team name"
            hint={isAdmin ? 'Shown on the sign-in page and in the sidebar.' : 'Only admins can change this.'}
            submitLabel="Save"
            readOnly={!isAdmin}
            onSubmit={async () => {
              try {
                const { settings } = await api('/api/settings', {
                  method: 'PATCH',
                  body: { team_name: teamName },
                });
                setTeam(settings.team_name);
                queryClient.setQueryData(['settings'], settings);
                setTeamName(null);
                toast('Team name saved');
                return null;
              } catch (err) {
                return err instanceof ApiError ? err.message : 'Save failed';
              }
            }}
          >
            <div className="field">
              <label className="label" htmlFor="team">
                Name
              </label>
              <input
                id="team"
                className="input"
                name="team_name"
                value={teamName}
                maxLength={60}
                required
                readOnly={!isAdmin}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
          </Section>
          <Section
            title="Change your password"
            hint={`Signed in as ${me.email}. Changing it signs you out on other devices.`}
            submitLabel="Change password"
            onSubmit={async (form) => {
              const f = new FormData(form);
              if (f.get('new') !== f.get('again')) return 'The new passwords don’t match';
              try {
                await api('/api/me/password', {
                  body: { current_password: f.get('current'), new_password: f.get('new') },
                });
                form.reset();
                toast('Password changed');
                return null;
              } catch (err) {
                return err instanceof ApiError ? err.message : 'Change failed';
              }
            }}
          >
            <div className="field">
              <label className="label" htmlFor="cur">
                Current password
              </label>
              <input
                id="cur"
                className="input"
                type="password"
                name="current"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="new">
                New password
              </label>
              <input
                id="new"
                className="input"
                type="password"
                name="new"
                autoComplete="new-password"
                required
                minLength={8}
              />
              <span className="tiny muted">At least 8 characters.</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="again">
                New password again
              </label>
              <input
                id="again"
                className="input"
                type="password"
                name="again"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
          </Section>
        </div>
      )}
    </>
  );
}
