// Sources page: connect a new source in 4 steps, and manage existing ones.
import { api, ApiError } from './api.js';
import { copyText, formDialog, h, icon, mount, toast } from './dom.js';
import { ago } from './format.js';
import { boot, loadProjectContext, shell, topbar } from './shell.js';
import { snippets } from './snippets.js';

const PLATFORMS = ['JavaScript', 'Python', 'Go', 'HTTP'];
const POLL_MS = 3000;

async function main() {
  const [{ user: me, team_name }, { project, projects }, status] = await Promise.all([
    boot(),
    loadProjectContext(),
    api('/api/status'),
  ]);
  /** @type {any[]} */
  let sources = (await api(`/api/projects/${project.id}/sources`)).sources;
  /** @type {{ source: any, token: string } | null} */
  let fresh = null;
  let platform = 'JavaScript';
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let poll;

  const { main } = shell({
    me,
    team: team_name,
    active: 'sources',
    project,
    projects,
    sourceCount: sources.length,
  });
  const endpoint = `${location.origin}/v1/logs`;
  const lagText =
    status.lag_ms > 0
      ? `Events land about ${Math.round(status.lag_ms / 1000)} seconds after they're sent.`
      : 'Events show up within a few seconds.';
  const stepsEl = h('ol.steps');
  const tableEl = h('div');

  main.append(
    topbar(
      'Sources',
      [
        h(
          'span.small.muted',
          null,
          `${project.name} · ${sources.length ? `${sources.length} connected` : 'new project'}`,
        ),
      ],
      [h('a.btn', { href: '/' }, 'Back to projects')],
    ),
    h(
      'div.connect',
      null,
      h('div', { class: 'stack' }, h('h2.sr', null, 'Connect a source'), stepsEl, tableEl),
      h(
        'aside.card.aside',
        null,
        h('h2', null, 'What gets stored'),
        h(
          'p',
          null,
          'Every event becomes a row with ',
          h('code', null, 'time'),
          ', ',
          h('code', null, 'level'),
          ', ',
          h('code', null, 'source'),
          ', ',
          h('code', null, 'message'),
          ' and any extra fields you send. Extra fields become filterable and chartable.',
        ),
        h(
          'dl',
          null,
          h('dt', null, 'endpoint'),
          h('dd', null, 'POST /v1/logs'),
          h('dt', null, 'batch'),
          h('dd', null, 'up to 5 MB'),
          h('dt', null, 'delay'),
          h('dd', null, status.lag_ms > 0 ? `~${Math.round(status.lag_ms / 1000)} s` : 'seconds'),
        ),
      ),
    ),
  );

  /**
   * @param {number} n
   * @param {'done' | 'active' | 'locked' | ''} state
   * @param {string} title
   * @param {...(Node | null)} body
   */
  const step = (n, state, title, ...body) =>
    h(
      `li.step${state ? `.${state}` : ''}`,
      null,
      h(
        'div.rail',
        null,
        h(
          'span.num',
          { 'aria-current': state === 'active' ? 'step' : null },
          state === 'done' ? icon('check', 12) : String(n),
        ),
      ),
      h('div.content', null, h('h2', null, title), ...body),
    );

  function renderSteps() {
    const name = h('input.input.mono#svc', {
      name: 'name',
      required: true,
      maxlength: 64,
      placeholder: 'api',
      autocomplete: 'off',
      value: fresh?.source.name ?? '',
    });
    const nameForm = h(
      'form.rowline',
      null,
      name,
      fresh ? null : h('button.btn.primary', { type: 'submit' }, 'Create source'),
    );
    if (fresh) name.setAttribute('readonly', '');
    nameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api(`/api/projects/${project.id}/sources`, {
          body: { name: /** @type {HTMLInputElement} */ (name).value },
        });
        fresh = { source: res.source, token: res.token };
        sources = [...sources, res.source];
        render();
        startListening();
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not create the source');
      }
    });

    const platforms = h(
      'div.platforms',
      { role: 'group', 'aria-labelledby': 'plat-h' },
      ...PLATFORMS.map((p) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(platform === p),
            onclick: () => {
              platform = p;
              renderSteps();
            },
          },
          h('span', null, p),
          h('span', null, snippets('', '', '')[/** @type {'Go'} */ (p)].tag),
        ),
      ),
    );

    const hint = fresh ? `${fresh.token.slice(0, 8)}…${fresh.token.slice(-4)}` : 'ol_…';
    const snip = snippets(endpoint, fresh?.source.name ?? 'my-service', hint)[/** @type {'Go'} */ (platform)];
    const codeBlock = h(
      'div.code',
      null,
      h(
        'div.bar',
        null,
        h('span', null, snip.file),
        h(
          'button',
          { type: 'button', onclick: async (/** @type {Event} */ e) => flash(e, await copyText(snip.code)) },
          icon('copy', 13),
          'Copy',
        ),
      ),
      h('pre', { 'data-testid': 'snippet' }, snip.code),
    );
    const tokenRow = fresh
      ? h(
          'div.tokenrow',
          null,
          h('span.k', null, 'Token'),
          h('code', { 'data-testid': 'token' }, fresh.token),
          h(
            'button.btn',
            {
              type: 'button',
              onclick: async (/** @type {Event} */ e) => flash(e, await copyText(fresh?.token ?? '')),
            },
            'Copy token',
          ),
          h(
            'button.btn.link',
            { type: 'button', onclick: () => fresh && regenerate(fresh.source) },
            'Regenerate token',
          ),
        )
      : null;

    const got = fresh && sources.find((x) => x.id === fresh?.source.id)?.last_event_at;
    const verify = fresh
      ? h(
          `div.verify${got ? '.got' : '.listening'}`,
          { role: 'status', 'data-testid': 'verify' },
          h('span.beacon', { 'aria-hidden': 'true' }, h('span.ring'), h('span')),
          h(
            'div.text',
            null,
            h(
              'span',
              null,
              got ? 'First event received from ' : 'Listening for the first event from ',
              h('span.mono', null, fresh.source.name),
              got ? '' : '…',
            ),
            h('span', null, got ? 'You’re connected.' : `${lagText} This page updates on its own.`),
          ),
          h('a.btn', { href: `/tail?project=${encodeURIComponent(project.id)}` }, 'Open live tail →'),
        )
      : h('p.small.muted', null, 'Create a source to get its token.');

    mount(
      stepsEl,
      step(
        1,
        fresh ? 'done' : 'active',
        'Name the source',
        h(
          'label.small.muted',
          { for: 'svc' },
          'One source per service. Events from it are tagged with this name.',
        ),
        nameForm,
      ),
      step(2, fresh ? 'done' : 'locked', 'Pick a platform', platforms),
      step(
        3,
        fresh ? (got ? 'done' : 'active') : 'locked',
        'Send your first event',
        h(
          'div.spread',
          null,
          h(
            'span.small.muted',
            null,
            'Set ',
            h('code', null, 'LOGS_TOKEN'),
            ' and send one event. No SDK needed: it’s one HTTP POST.',
          ),
          h('span.pill.warn', null, icon('warn', 12), 'Token shown once'),
        ),
        codeBlock,
        tokenRow,
      ),
      step(4, got ? 'done' : fresh ? 'active' : 'locked', 'Verify', verify),
    );
    stepsEl.querySelector('h2')?.setAttribute('id', 'name-h');
    stepsEl.querySelectorAll('.step')[1]?.querySelector('h2')?.setAttribute('id', 'plat-h');
  }

  /** @param {any} source */
  async function regenerate(source) {
    const ok = await formDialog(
      `Regenerate token for ${source.name}?`,
      [
        h(
          'p.small.muted',
          null,
          'The current token stops working immediately. Apps using it will get 401 until you update them.',
        ),
      ],
      'Regenerate',
    );
    if (!ok) return;
    const res = await api(`/api/sources/${source.id}/regenerate`, { method: 'POST' });
    fresh = { source: res.source, token: res.token };
    sources = sources.map((x) => (x.id === res.source.id ? res.source : x));
    render();
    stepsEl.scrollIntoView({ behavior: 'smooth' });
  }

  /** @param {any} source */
  async function remove(source) {
    const ok = await formDialog(
      `Delete source ${source.name}?`,
      [h('p.small.muted', null, 'Its token stops working. Logs already stored stay.')],
      'Delete',
    );
    if (!ok) return;
    try {
      await api(`/api/sources/${source.id}`, { method: 'DELETE' });
      sources = sources.filter((x) => x.id !== source.id);
      if (fresh?.source.id === source.id) fresh = null;
      render();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  function renderTable() {
    if (!sources.length) return mount(tableEl);
    mount(
      tableEl,
      h(
        'section.card.sources',
        { 'aria-label': 'Connected sources' },
        h('div.bar', null, 'Connected sources'),
        h(
          'table.grid',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ...['Source', 'Token', 'Last event', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)),
            ),
          ),
          h(
            'tbody',
            null,
            ...sources.map((src) => {
              const rejecting =
                src.rejected_count > 0 && (!src.last_event_at || src.last_rejected_at > src.last_event_at);
              return h(
                'tr',
                { 'data-testid': 'source-row' },
                h('td', null, h('span.mono', null, src.name)),
                h('td', null, h('code.small.muted', null, `${src.token_prefix}…`)),
                h(
                  'td',
                  null,
                  h('span.small.muted', null, src.last_event_at ? ago(src.last_event_at) : 'never'),
                ),
                h(
                  'td',
                  null,
                  rejecting
                    ? h(
                        'span.pill.err',
                        { title: `${src.rejected_count} requests rejected with 401` },
                        `${src.rejected_count} rejected`,
                      )
                    : src.last_event_at
                      ? h('span.pill.ok', null, 'Receiving')
                      : h('span.pill', null, 'Waiting'),
                ),
                h(
                  'td',
                  null,
                  h(
                    'div.acts',
                    null,
                    h('button.btn', { type: 'button', onclick: () => regenerate(src) }, 'Regenerate token'),
                    me.role !== 'member'
                      ? h('button.btn.danger', { type: 'button', onclick: () => remove(src) }, 'Delete')
                      : null,
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  function render() {
    renderSteps();
    renderTable();
    const count = document.querySelector('.nav a[href^="/connect"] .count');
    if (count) count.textContent = String(sources.length);
  }

  function startListening() {
    clearInterval(poll);
    poll = setInterval(async () => {
      if (!fresh) return clearInterval(poll);
      const res = await api(`/api/projects/${project.id}/sources`).catch(() => null);
      if (!res) return;
      sources = res.sources;
      if (sources.find((x) => x.id === fresh?.source.id)?.last_event_at) {
        clearInterval(poll);
        render();
      }
    }, POLL_MS);
  }

  render();
}

/**
 * @param {Event} e
 * @param {boolean} ok
 */
function flash(e, ok) {
  const btn = /** @type {HTMLElement} */ (e.currentTarget);
  const text = [...btn.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (!text) return;
  const before = text.textContent;
  text.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => (text.textContent = before), 1600);
}

main();
