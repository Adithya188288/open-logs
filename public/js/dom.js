// Tiny element builder. Text always goes through textContent: log data is attacker-controlled.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button.btn.primary', { onclick, 'aria-pressed': 'true' }, 'Save')
 * @param {string} tag  tag name with optional `.class` and `#id` parts
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...(Node | string | number | null | undefined | false | (Node | string)[])} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest) {
    if (part.startsWith('.')) el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

/**
 * SVG element with attributes (numbers are fine).
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs]
 * @param {...(Node | null | undefined | false)} children
 */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/**
 * @param {HTMLElement} el
 * @param {Record<string, unknown> | null | undefined} attrs
 */
function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2), /** @type {EventListener} */ (v));
    else if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') /** @type {HTMLInputElement} */ (el).value = String(v);
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'autofocus')
      /** @type {any} */ (el)[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

/**
 * @param {Node} el
 * @param {unknown[]} children
 */
function append(el, children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * Replaces all children of `el`.
 * @param {Element} el
 * @param {...unknown} children
 */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/** @param {string} sel */
export function $(sel) {
  return /** @type {HTMLElement} */ (document.querySelector(sel));
}

/** Inline SVG icons (paths from the design). */
const ICONS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  team: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  tail: 'M4 6h16M4 12h10M4 18h13',
  chart: 'M5 20V11M11 20V5M17 20v-6M3 20h18',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 8v5M12 16h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  nothing: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8.5 11h5',
  home: 'M4 20V10l8-6 8 6v10h-5v-6H9v6z',
  folders: 'M3 7h6l2 2h10v10H3zM3 7V5h6l2 2',
  chevron: 'M8 10l4 4 4-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};

/**
 * @param {keyof typeof ICONS} name
 * @param {number} [size]
 */
export function icon(name, size = 16) {
  return s(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.75,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    s('path', { d: ICONS[name] }),
  );
}

/** @param {string} message */
export function toast(message) {
  const el = h('div.toast', { role: 'status' }, message);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/** @param {string} text */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Modal dialog with a form. Resolves with the submitted FormData values, or null on cancel.
 * @param {string} title
 * @param {HTMLElement[]} fields
 * @param {string} submitLabel
 * @param {(values: Record<string, string>) => Promise<string | null | void>} [onSubmit]  return an error message to keep it open
 * @returns {Promise<Record<string, string> | null>}
 */
export function formDialog(title, fields, submitLabel, onSubmit) {
  return new Promise((resolve) => {
    const error = h('p.error-text', { role: 'alert' });
    const form = h(
      'form.dialog',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title),
      ...fields,
      error,
      h(
        'div.row',
        null,
        h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button.btn.primary', { type: 'submit' }, submitLabel),
      ),
    );
    const backdrop = h(
      'div.dialog-backdrop',
      { onmousedown: (/** @type {Event} */ e) => e.target === backdrop && close(null) },
      form,
    );
    /** @param {Record<string, string> | null} v */
    const close = (v) => {
      backdrop.remove();
      resolve(v);
    };
    form.addEventListener('keydown', (e) => e.key === 'Escape' && close(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(
        [...new FormData(/** @type {HTMLFormElement} */ (form)).entries()].map(([k, v]) => [k, String(v)]),
      );
      const problem = onSubmit ? await onSubmit(values) : null;
      if (problem) error.textContent = problem;
      else close(values);
    });
    document.body.appendChild(backdrop);
    /** @type {HTMLElement | null} */ (form.querySelector('input, select'))?.focus();
  });
}

/**
 * Popover menu anchored under a button. Closes on outside click or Escape.
 * @param {HTMLElement} anchor
 * @param {HTMLElement[]} items
 */
export function popMenu(anchor, items) {
  for (const m of document.querySelectorAll('.menu')) m.remove();
  const rect = anchor.getBoundingClientRect();
  const menu = h('div.menu', { role: 'menu' }, ...items);
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 220))}px`;
  document.body.appendChild(menu);
  const off = (/** @type {Event} */ e) => {
    if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.contains(/** @type {Node} */ (e.target))) {
      menu.remove();
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
  });
  menu.addEventListener('click', () => menu.remove());
  /** @type {HTMLElement | null} */ (menu.querySelector('button, a'))?.focus();
  return menu;
}

/**
 * Two-step delete: the button only works once the user types DELETE.
 * @param {{ title: string, body: string, confirmLabel?: string, onConfirm: () => Promise<string | null | void> }} o
 *   onConfirm may return an error message to keep the dialog open
 * @returns {Promise<boolean>} true when deleted
 */
export function confirmDelete(o) {
  return new Promise((resolve) => {
    const input = /** @type {HTMLInputElement} */ (
      h('input.input.mono#confirm-delete', {
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'DELETE',
      })
    );
    const button = /** @type {HTMLButtonElement} */ (
      h('button.btn.danger-fill', { type: 'submit', disabled: true }, o.confirmLabel ?? 'Delete')
    );
    const error = h('p.error-text', { role: 'alert' });
    const form = h(
      'form.dialog',
      { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('h2', null, o.title),
      h('p.small.muted', null, o.body),
      h('div.field', null, h('label.label', { for: 'confirm-delete' }, 'Type DELETE to confirm'), input),
      error,
      h('div.row', null, h('button.btn', { type: 'button', onclick: () => close(false) }, 'Cancel'), button),
    );
    const backdrop = h(
      'div.dialog-backdrop',
      { onmousedown: (/** @type {Event} */ e) => e.target === backdrop && close(false) },
      form,
    );
    /** @param {boolean} v */
    const close = (v) => {
      backdrop.remove();
      resolve(v);
    };
    input.addEventListener('input', () => {
      button.disabled = input.value !== 'DELETE';
    });
    form.addEventListener('keydown', (e) => e.key === 'Escape' && close(false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (input.value !== 'DELETE') return;
      button.disabled = true;
      const problem = await o.onConfirm();
      if (problem) {
        error.textContent = problem;
        button.disabled = false;
      } else close(true);
    });
    document.body.appendChild(backdrop);
    input.focus();
  });
}

/**
 * A plain modal with arbitrary content (used for multi-step flows like creating a source).
 * @param {string} title
 * @param {(close: () => void) => HTMLElement[]} build
 * @param {{ wide?: boolean, onClose?: () => void }} [opts]
 */
export function modal(title, build, opts = {}) {
  const box = h(`div.dialog${opts.wide ? '.wide' : ''}`, {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });
  const backdrop = h(
    'div.dialog-backdrop',
    { onmousedown: (/** @type {Event} */ e) => e.target === backdrop && close() },
    box,
  );
  const close = () => {
    backdrop.remove();
    opts.onClose?.();
  };
  box.append(
    h(
      'div.spread',
      null,
      h('h2', null, title),
      h('button.iconbtn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')),
    ),
    ...build(close),
  );
  box.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.appendChild(backdrop);
  /** @type {HTMLElement | null} */ (box.querySelector('input, select, button:not(.iconbtn)'))?.focus();
  return { box, close };
}
