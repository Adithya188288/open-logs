// Settings (/settings): team name and your password.
import { api, ApiError } from './api.js';
import { h, toast } from './dom.js';
import { page, topbar } from './shell.js';

/**
 * @param {string} title
 * @param {string} hint
 * @param {HTMLElement[]} fields
 * @param {string} submitLabel
 * @param {(form: HTMLFormElement) => Promise<string | null>} onSubmit  returns an error message or null
 * @param {boolean} [readOnly]
 */
function section(title, hint, fields, submitLabel, onSubmit, readOnly = false) {
  const error = h('p.error-text', { role: 'alert' });
  const form = /** @type {HTMLFormElement} */ (
    h(
      'form.card.settings',
      { 'aria-label': title },
      h('div', null, h('h2', null, title), h('p.small.muted', null, hint)),
      ...fields,
      error,
      readOnly ? null : h('div', null, h('button.btn.primary', { type: 'submit' }, submitLabel)),
    )
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = (await onSubmit(form)) ?? '';
  });
  return form;
}

async function main() {
  const { me, main } = await page('settings', { required: false });
  const { settings } = await api('/api/settings');
  const isAdmin = me.role !== 'member';
  const teamName = /** @type {HTMLInputElement} */ (
    h('input.input#team', {
      name: 'team_name',
      value: settings.team_name,
      maxlength: 60,
      required: true,
      readonly: !isAdmin,
    })
  );
  const current = /** @type {HTMLInputElement} */ (
    h('input.input#cur', { type: 'password', autocomplete: 'current-password', required: true })
  );
  const next = /** @type {HTMLInputElement} */ (
    h('input.input#new', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 })
  );
  const again = /** @type {HTMLInputElement} */ (
    h('input.input#again', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 })
  );

  main.append(
    topbar('Settings', [], []),
    h(
      'div.page.narrow',
      null,
      section(
        'Team name',
        isAdmin ? 'Shown on the sign-in page and in the sidebar.' : 'Only admins can change this.',
        [h('div.field', null, h('label.label', { for: 'team' }, 'Name'), teamName)],
        'Save',
        async () => {
          try {
            await api('/api/settings', { method: 'PATCH', body: { team_name: teamName.value } });
            const brand = document.querySelector('.nav .brand span:last-child');
            if (brand) brand.textContent = teamName.value.trim();
            toast('Team name saved');
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Save failed';
          }
        },
        !isAdmin,
      ),
      section(
        'Change your password',
        `Signed in as ${me.email}. Changing it signs you out on other devices.`,
        [
          h('div.field', null, h('label.label', { for: 'cur' }, 'Current password'), current),
          h(
            'div.field',
            null,
            h('label.label', { for: 'new' }, 'New password'),
            next,
            h('span.tiny.muted', null, 'At least 8 characters.'),
          ),
          h('div.field', null, h('label.label', { for: 'again' }, 'New password again'), again),
        ],
        'Change password',
        async (form) => {
          if (next.value !== again.value) return 'The new passwords don’t match';
          try {
            await api('/api/me/password', {
              body: { current_password: current.value, new_password: next.value },
            });
            form.reset();
            toast('Password changed');
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Change failed';
          }
        },
      ),
    ),
  );
}

main();
