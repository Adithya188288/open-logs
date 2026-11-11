// Team (/team): members, pending invites, invite a teammate.
import { useQuery } from '@tanstack/react-query';
import { confirmDelete, FormDialog, Modal, openDialog, toast } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { PageLoader, Topbar, useApp } from '../components/Layout.jsx';
import { ApiError, api } from '../lib/api.js';
import { ago, cap, initials } from '../lib/format.js';
import { q, refresh } from '../lib/queries.js';
import { copyText } from '../lib/store.js';

export function Team() {
  const { me } = useApp();
  const { data } = useQuery(q.team());
  const load = refresh.team;

  const invite = () =>
    openDialog((close) => (
      <FormDialog
        title="Invite a teammate"
        submitLabel="Send invite"
        onClose={close}
        onSubmit={async (v) => {
          try {
            const result = await api('/api/invites', { body: { email: v.email, role: v.role } });
            load();
            setTimeout(() => showInvite(result));
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Invite failed';
          }
        }}
      >
        <div className="field">
          <label className="label" htmlFor="inv">
            Email
          </label>
          <input
            id="inv"
            className="input"
            type="email"
            name="email"
            required
            placeholder="teammate@company.com"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="role">
            Role
          </label>
          <select id="role" className="select" name="role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </FormDialog>
    ));

  /** @param {any} result */
  const showInvite = (result) =>
    openDialog((close) => (
      <Modal title="Invite created" onClose={close}>
        <p className="small">{`Share this link with ${result.invite.email}:`}</p>
        <code className="invite-url" data-testid="invite-url">
          {result.invite_url}
        </code>
        <p className="tiny muted">The link works once and expires in 7 days.</p>
        <div className="row">
          <button
            className="btn primary"
            type="button"
            onClick={async () => toast((await copyText(result.invite_url)) ? 'Link copied' : 'Copy failed')}
          >
            <Icon name="copy" size={13} />
            Copy link
          </button>
        </div>
      </Modal>
    ));

  /** @param {any} u */
  const remove = (u) =>
    confirmDelete({
      title: `Remove ${u.name}?`,
      body: `${u.email} is signed out everywhere and loses access. Invites they sent are cancelled.`,
      confirmLabel: 'Remove teammate',
      onConfirm: async () => {
        try {
          await api(`/api/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
          await load();
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Remove failed';
        }
      },
    });

  return (
    <>
      <Topbar title="Team">
        {me.role !== 'member' && (
          <button className="btn primary" type="button" onClick={invite}>
            <Icon name="plus" size={14} />
            Invite teammate
          </button>
        )}
      </Topbar>
      {!data ? (
        <PageLoader />
      ) : (
        <div className="page">
          <section className="card team" aria-label="Team members">
            <table className="grid">
              <thead>
                <tr>
                  {['Name', 'Email', 'Role', 'Last active', ''].map((t) => (
                    <th key={t} scope="col">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} data-testid="member-row">
                    <td>
                      <span className="who">
                        <span className="avatar sm" aria-hidden="true">
                          {initials(u.name)}
                        </span>
                        {u.name}
                        {u.id === me.id && <span className="muted small"> (you)</span>}
                      </span>
                    </td>
                    <td>
                      <span className="email">{u.email}</span>
                    </td>
                    <td>
                      <span className="pill">{cap(u.role)}</span>
                    </td>
                    <td>
                      <span className="small muted">
                        {u.last_active_at
                          ? Date.now() - u.last_active_at < 120_000
                            ? 'now'
                            : ago(u.last_active_at)
                          : '—'}
                      </span>
                    </td>
                    <td className="right">
                      {me.role === 'owner' && u.id !== me.id && (
                        <button className="btn danger" type="button" onClick={() => remove(u)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {data.invites.map((i) => (
                  <tr key={i.id} data-testid="invite-row">
                    <td>
                      <span className="who muted">
                        <span className="avatar sm" aria-hidden="true">
                          ?
                        </span>
                        Invited
                      </span>
                    </td>
                    <td>
                      <span className="email">{i.email}</span>
                    </td>
                    <td>
                      <span className="pill warn">{cap(i.role)}</span>
                    </td>
                    <td>
                      <span className="small muted">
                        expires {new Date(i.expires_at).toISOString().slice(0, 10)}
                      </span>
                    </td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="small muted">
            Everyone on the team can see every project. Admins can invite people and delete projects or
            sources.
          </p>
        </div>
      )}
    </>
  );
}
