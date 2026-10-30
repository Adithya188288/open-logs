// "How to send" panel: platform picker + snippet, and the one-time token row when we have it.
import { copyText, h, icon, mount } from './dom.js';
import { PLATFORMS, snippets } from './snippets.js';

/**
 * @param {Event} e
 * @param {boolean} ok
 */
export function flashCopied(e, ok) {
  const btn = /** @type {HTMLElement} */ (e.currentTarget);
  const text = [...btn.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (!text) return;
  const before = text.textContent;
  text.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => (text.textContent = before), 1600);
}

/**
 * @param {{ sourceName: string, tokenPrefix?: string, token?: string }} o
 */
export function sendPanel(o) {
  const endpoint = `${location.origin}/v1/logs`;
  let platform = /** @type {(typeof PLATFORMS)[number]} */ ('JavaScript');
  const root = h('div.sendpanel');
  const hint = o.token ? `${o.token.slice(0, 8)}…${o.token.slice(-4)}` : `${o.tokenPrefix ?? 'ol_'}…`;

  const render = () => {
    const snip = snippets(endpoint, o.sourceName, hint)[platform];
    mount(
      root,
      h(
        'div.platforms',
        { role: 'group', 'aria-label': 'Platform' },
        ...PLATFORMS.map((p) =>
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(platform === p),
              onclick: () => {
                platform = p;
                render();
              },
            },
            h('span', null, p),
            h('span', null, snippets('', '', '')[p].tag),
          ),
        ),
      ),
      h(
        'div.code',
        null,
        h(
          'div.bar',
          null,
          h('span', null, snip.file),
          h(
            'button',
            {
              type: 'button',
              onclick: async (/** @type {Event} */ e) => flashCopied(e, await copyText(snip.code)),
            },
            icon('copy', 13),
            'Copy',
          ),
        ),
        h('pre', { 'data-testid': 'snippet' }, snip.code),
      ),
      o.token
        ? h(
            'div.tokenrow',
            null,
            h('span.k', null, 'Token'),
            h('code', { 'data-testid': 'token' }, o.token),
            h(
              'button.btn',
              {
                type: 'button',
                onclick: async (/** @type {Event} */ e) => flashCopied(e, await copyText(o.token ?? '')),
              },
              'Copy token',
            ),
          )
        : null,
      o.token
        ? h(
            'p.tiny.warn-text',
            null,
            icon('warn', 12),
            ' Copy the token now. It isn’t shown again; you can regenerate it later.',
          )
        : h(
            'p.tiny.muted',
            null,
            'Set LOGS_TOKEN to this source’s token. Lost it? Regenerate the token above.',
          ),
    );
  };
  render();
  return root;
}
