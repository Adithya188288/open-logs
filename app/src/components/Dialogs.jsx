// Dialogs, confirmations and toasts. Any screen can open one; <Overlays/> renders them.
import { useEffect, useRef, useState } from 'react';
import { createStore, useStore } from '../lib/store.js';
import { Icon } from './Icon.jsx';

/** @typedef {(close: () => void) => import('react').ReactNode} DialogRender */

const dialogs = createStore(/** @type {{ id: number, render: DialogRender }[]} */ ([]));
const toasts = createStore(/** @type {{ id: number, text: string }[]} */ ([]));
let nextId = 1;

/**
 * Opens a dialog; `render(close)` returns its content. Returns close().
 * @param {DialogRender} render
 */
export function openDialog(render) {
  const id = nextId++;
  const close = () => dialogs.set((list) => list.filter((d) => d.id !== id));
  dialogs.set((list) => [...list, { id, render }]);
  return close;
}

/** @param {string} text */
export function toast(text) {
  const id = nextId++;
  toasts.set((list) => [...list, { id, text }]);
  setTimeout(() => toasts.set((list) => list.filter((t) => t.id !== id)), 2200);
}

export function Overlays() {
  const open = useStore(dialogs);
  const shown = useStore(toasts);
  return (
    <>
      {open.map((d) => (
        <Backdrop key={d.id} onClose={() => dialogs.set((l) => l.filter((x) => x.id !== d.id))}>
          {d.render(() => dialogs.set((l) => l.filter((x) => x.id !== d.id)))}
        </Backdrop>
      ))}
      {shown.map((t) => (
        <div key={t.id} className="toast" role="status">
          {t.text}
        </div>
      ))}
    </>
  );
}

/** @param {{ onClose: () => void, children: import('react').ReactNode }} props */
function Backdrop({ onClose, children }) {
  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed backdrop closes the dialog; Escape does too
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

/**
 * A dialog with a form. `onSubmit` gets the form values and returns an error message to stay open.
 * @param {{ title: string, submitLabel: string, onSubmit?: (values: Record<string, string>) => Promise<string | null | void> | string | null | void, onClose: () => void, children?: import('react').ReactNode }} props
 */
export function FormDialog({ title, submitLabel, onSubmit, onClose, children }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(/** @type {HTMLFormElement | null} */ (null));
  useEffect(() => {
    /** @type {HTMLElement | null | undefined} */ (ref.current?.querySelector('input, select'))?.focus();
  }, []);
  return (
    <form
      ref={ref}
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const values = Object.fromEntries(
          [...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]),
        );
        const problem = onSubmit ? await onSubmit(values) : null;
        setBusy(false);
        if (problem) setError(problem);
        else onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
      <p className="error-text" role="alert">
        {error}
      </p>
      <div className="row">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Two-step delete: the button only works once DELETE is typed.
 * @param {{ title: string, body: string, confirmLabel?: string, onConfirm: () => Promise<string | null | void>, onClose: () => void }} props
 */
export function ConfirmDelete({ title, body, confirmLabel = 'Delete', onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onSubmit={async (e) => {
        e.preventDefault();
        if (typed !== 'DELETE') return;
        setBusy(true);
        const problem = await onConfirm();
        setBusy(false);
        if (problem) setError(problem);
        else onClose();
      }}
    >
      <h2>{title}</h2>
      <p className="small muted">{body}</p>
      <div className="field">
        <label className="label" htmlFor="confirm-delete">
          Type DELETE to confirm
        </label>
        <input
          id="confirm-delete"
          className="input mono"
          autoComplete="off"
          spellCheck="false"
          placeholder="DELETE"
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <p className="error-text" role="alert">
        {error}
      </p>
      <div className="row">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger-fill" type="submit" disabled={typed !== 'DELETE' || busy}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Plain modal with a close button.
 * @param {{ title: string, wide?: boolean, onClose: () => void, children: import('react').ReactNode }} props
 */
export function Modal({ title, wide, onClose, children }) {
  return (
    <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="spread">
        <h2>{title}</h2>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {children}
    </div>
  );
}

/** @param {Parameters<typeof ConfirmDelete>[0] extends infer P ? Omit<P, 'onClose'> : never} props */
export function confirmDelete(props) {
  openDialog((close) => <ConfirmDelete {...props} onClose={close} />);
}
