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
  document.querySelectorAll('.menu').forEach((m) => m.remove());
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
