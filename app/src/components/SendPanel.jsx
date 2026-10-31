// "How to send" panel: the one-time token (when we have it), platform picker, and snippet.
import { useState } from 'react';
import { copyText } from '../lib/store.js';
import { PLATFORMS, snippets } from '../lib/snippets.js';
import { Icon } from './Icon.jsx';

/** A copy button whose label briefly says "Copied". @param {{ text: string, className?: string, children: import('react').ReactNode }} props */
export function CopyButton({ text, className = 'btn', children }) {
  const [state, setState] = useState(/** @type {null | boolean} */ (null));
  return (
    <button
      className={className}
      type="button"
      onClick={async () => {
        setState(await copyText(text));
        setTimeout(() => setState(null), 1600);
      }}
    >
      {state === null ? children : state ? 'Copied' : 'Copy failed'}
    </button>
  );
}

/** A freshly issued token with its copy button and the shown-once warning. @param {{ token: string }} props */
export function TokenPanel({ token }) {
  return (
    <>
      <div className="tokenrow">
        <span className="k">Token</span>
        <code data-testid="token">{token}</code>
        <CopyButton text={token}>Copy token</CopyButton>
      </div>
      <p className="tiny warn-text">
        <Icon name="warn" size={12} /> Copy the token now. It isn’t shown again; you can regenerate it later.
      </p>
    </>
  );
}

/** @param {{ sourceName: string, tokenPrefix?: string, token?: string }} props */
export function SendPanel({ sourceName, tokenPrefix, token }) {
  const [platform, setPlatform] = useState(/** @type {(typeof PLATFORMS)[number]} */ ('JavaScript'));
  const endpoint = `${window.location.origin}/v1/logs`;
  const hint = token ? `${token.slice(0, 8)}…${token.slice(-4)}` : `${tokenPrefix ?? 'ol_'}…`;
  const snip = snippets(endpoint, sourceName, hint)[platform];
  return (
    <div className="sendpanel">
      {token && <TokenPanel token={token} />}
      <div className="platforms" role="group" aria-label="Platform">
        {PLATFORMS.map((p) => (
          <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)}>
            <span>{p}</span>
            <span>{snippets('', '', '')[p].tag}</span>
          </button>
        ))}
      </div>
      <div className="code">
        <div className="bar">
          <span>{snip.file}</span>
          <CopyButton className="" text={snip.code}>
            <Icon name="copy" size={13} />
            Copy
          </CopyButton>
        </div>
        <pre data-testid="snippet">{snip.code}</pre>
      </div>
      {!token && (
        <p className="tiny muted">
          Set LOGS_TOKEN to this source’s token. Lost it? Regenerate the token above.
        </p>
      )}
    </div>
  );
}
